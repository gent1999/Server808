import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import Stripe from "stripe";
import multer from "multer";
import { sendOwnerNotification, sendCustomerConfirmation } from "../utils/email.js";
import { uploadImage } from "../utils/storage.js";
import { createOrder as createPaypalOrder, captureOrder as capturePaypalOrder } from "../utils/paypal.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// "Guaranteed Article" is PayPal-only and always exactly this price -- never
// read from the client, per the security requirement that the frontend can
// never submit its own amount.
const GUARANTEED_ARTICLE_PRICE_USD = 10.00;
const GUARANTEED_ARTICLE_PRICE_CENTS = 1000;

// ── Multer ─────────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) return cb(null, true);
    if (file.fieldname === 'document') {
      const allowed = [
        'text/plain','application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      return allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only txt, doc, docx, pdf allowed'), false);
    }
    cb(new Error('Invalid file type'), false);
  },
});

const UPLOAD_FIELDS = upload.fields([
  { name: 'image',    maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

// ── Pricing ────────────────────────────────────────────────────────────────────
const PAID_TYPES = ['regular', 'priority', 'featured', 'genius'];

function getAmount(type) {
  if (type === 'featured') return 700;  // legacy $7
  if (type === 'genius')   return 1000; // $10
  return 500;                           // regular / priority → $5
}

// ── Safe INSERT: tries new schema, falls back to old schema on any constraint error ──
// This lets the endpoint work before the migration is run, and fully after.
async function safeInsert(fields) {
  const {
    artist_name, email, title, content,
    youtube_url, spotify_url, soundcloud_url,
    apple_music_url, instagram_url, genre,
    image_url, document_url,
    genius_song_url, genius_lyrics,
    submission_type, payment_amount, payment_id, payment_status,
    payment_provider, paypal_order_id, paypal_capture_id, paid_at,
  } = fields;

  // ── Attempt 1: full new-schema INSERT ────────────────────────────────────────
  try {
    return await pool.query(
      `INSERT INTO music_submissions
         (artist_name, email, title, content,
          youtube_url, spotify_url, soundcloud_url,
          apple_music_url, instagram_url, genre,
          image_url, document_url, genius_song_url, genius_lyrics,
          submission_type, payment_amount, payment_id, payment_status, submission_status,
          payment_provider, paypal_order_id, paypal_capture_id, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',$19,$20,$21,$22)
       RETURNING id, artist_name, email, title, submission_type, created_at`,
      [
        artist_name, email, title||null, content||null,
        youtube_url||null, spotify_url||null, soundcloud_url||null,
        apple_music_url||null, instagram_url||null, genre||null,
        image_url||null, document_url||null, genius_song_url||null, genius_lyrics||null,
        submission_type, payment_amount, payment_id||null, payment_status,
        payment_provider||null, paypal_order_id||null, paypal_capture_id||null, paid_at||null,
      ]
    );
  } catch (err) {
    // 42703 = undefined column  |  23514 = check constraint  |  23502 = not_null_violation
    if (!['42703','23514','23502'].includes(err.code)) throw err;

    console.warn(`[submissions] Pre-migration fallback (${err.code}). Run: node run-migration.js add-submission-fields.sql`);
  }

  // ── Attempt 2: original schema only (pre-migration) ──────────────────────────
  // Normalize submission_type to what the old CHECK constraint accepts
  const legacyType = ['regular','featured'].includes(submission_type) ? submission_type : 'regular';
  // payment_id is NOT NULL in the old schema — use a sentinel for free subs
  const legacyPaymentId = payment_id || `FREE-${Date.now()}`;

  return await pool.query(
    `INSERT INTO music_submissions
       (artist_name, email, title, content,
        youtube_url, spotify_url, soundcloud_url,
        image_url, document_url,
        submission_type, payment_amount, payment_id, payment_status, submission_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
     RETURNING id, artist_name, email, title, submission_type, created_at`,
    [
      artist_name, email, title||null, content||null,
      youtube_url||null, spotify_url||null, soundcloud_url||null,
      image_url||null, document_url||null,
      legacyType, payment_amount, legacyPaymentId, payment_status,
    ]
  );
}

// ── @route POST /api/submissions/create-payment-intent ─────────────────────────
router.post(
  "/create-payment-intent",
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("content").trim().notEmpty().withMessage("Content/description is required"),
    body("submission_type").isIn(PAID_TYPES).withMessage("Invalid submission type"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { submission_type, email, artist_name } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: getAmount(submission_type),
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        metadata: { artist_name, email, submission_type },
      });
      res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
    } catch (error) {
      console.error('Error creating payment intent:', error.message);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  }
);

// ── @route POST /api/submissions/free-submit ──────────────────────────────────
router.post(
  "/free-submit",
  UPLOAD_FIELDS,
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("content").trim().notEmpty().withMessage("Description is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      artist_name, email, title, content,
      youtube_url, spotify_url, soundcloud_url,
      apple_music_url, instagram_url, genre,
    } = req.body;

    try {
      let imageUrl = null;
      if (req.files?.image?.[0]) {
        imageUrl = await uploadImage(req.files.image[0].buffer, 'submissions');
      }

      const result = await safeInsert({
        artist_name, email, title, content,
        youtube_url, spotify_url, soundcloud_url,
        apple_music_url, instagram_url, genre,
        image_url: imageUrl, document_url: null,
        genius_song_url: null, genius_lyrics: null,
        submission_type: 'free', payment_amount: 0,
        payment_id: null, payment_status: 'free', payment_provider: null,
      });

      sendOwnerNotification({
        artist_name, email, title,
        submission_type: 'free', payment_amount: 0, content,
        youtube_url, spotify_url, soundcloud_url,
        apple_music_url, instagram_url, genre,
        image_url: imageUrl,
      }).catch(err => console.error('Owner email error:', err));

      sendCustomerConfirmation({
        artist_name, email,
        submission_type: 'free', payment_amount: 0,
      }).catch(err => console.error('Customer email error:', err));

      res.status(201).json({
        message: "Free submission received! We'll review your music and get back to you.",
        submission: result.rows[0],
      });
    } catch (error) {
      console.error('Error saving free submission:', error.message, error.code);
      res.status(500).json({ message: "Failed to save submission: " + error.message });
    }
  }
);

// ── @route POST /api/submissions/submit (paid) ────────────────────────────────
router.post(
  "/submit",
  UPLOAD_FIELDS,
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("payment_id").trim().notEmpty().withMessage("Payment ID is required"),
    body("submission_type").isIn(PAID_TYPES).withMessage("Invalid submission type"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      artist_name, email, title, content,
      youtube_url, spotify_url, soundcloud_url,
      apple_music_url, instagram_url, genre,
      payment_id, submission_type,
      genius_song_url, genius_lyrics,
    } = req.body;

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_id);
      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ message: "Payment not completed" });
      }

      let imageUrl = null;
      if (req.files?.image?.[0]) {
        imageUrl = await uploadImage(req.files.image[0].buffer, 'submissions');
      }

      let documentUrl = null;
      if (req.files?.document?.[0]) {
        documentUrl = await uploadImage(req.files.document[0].buffer, 'submissions');
      }

      const result = await safeInsert({
        artist_name, email, title, content: content||null,
        youtube_url, spotify_url, soundcloud_url,
        apple_music_url, instagram_url, genre,
        image_url: imageUrl, document_url: documentUrl,
        genius_song_url: genius_song_url||null, genius_lyrics: genius_lyrics||null,
        submission_type, payment_amount: paymentIntent.amount,
        payment_id, payment_status: 'completed', payment_provider: 'stripe',
      });

      sendOwnerNotification({
        artist_name, email, title, submission_type,
        payment_amount: paymentIntent.amount, content,
        youtube_url, spotify_url, soundcloud_url,
        apple_music_url, instagram_url, genre,
        image_url: imageUrl, document_url: documentUrl,
        genius_song_url, genius_lyrics,
      }).catch(err => console.error('Owner email error:', err));

      sendCustomerConfirmation({
        artist_name, email, submission_type,
        payment_amount: paymentIntent.amount,
      }).catch(err => console.error('Customer email error:', err));

      res.status(201).json({
        message: "Submission received! We'll review it and get back to you soon.",
        submission: result.rows[0],
      });
    } catch (error) {
      console.error('Error saving paid submission:', error.message, error.code);
      res.status(500).json({ message: "Failed to save submission: " + error.message });
    }
  }
);

// ── @route POST /api/submissions/paypal/create-order ──────────────────────────
// Creates a PayPal order for exactly $10.00 USD. The amount is never read
// from the client -- GUARANTEED_ARTICLE_PRICE_USD is the only source of truth.
router.post(
  "/paypal/create-order",
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("content").trim().notEmpty().withMessage("Content/description is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { orderId } = await createPaypalOrder(GUARANTEED_ARTICLE_PRICE_USD, 'USD');
      res.json({ orderId });
    } catch (error) {
      console.error('Error creating PayPal order:', error.message);
      res.status(500).json({ message: "Failed to create PayPal order" });
    }
  }
);

// ── @route POST /api/submissions/paypal/capture-order ─────────────────────────
// Verifies/captures the order directly with PayPal server-to-server and only
// then saves the submission as paid. Idempotent: a second call with the same
// paypal_order_id (duplicate callback, page refresh after success) returns
// the existing submission instead of capturing or inserting again.
router.post(
  "/paypal/capture-order",
  UPLOAD_FIELDS,
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("paypal_order_id").trim().notEmpty().withMessage("PayPal order ID is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      artist_name, email, title, content,
      youtube_url, spotify_url, soundcloud_url,
      apple_music_url, instagram_url, genre,
      paypal_order_id,
    } = req.body;

    try {
      // Idempotency check first -- never re-capture or re-insert for an
      // order we've already processed.
      const existing = await pool.query(
        'SELECT id, artist_name, email, title, submission_type, created_at FROM music_submissions WHERE paypal_order_id = $1',
        [paypal_order_id]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({
          message: "Submission already recorded for this payment.",
          submission: existing.rows[0],
        });
      }

      const capture = await capturePaypalOrder(paypal_order_id);
      if (capture.amount !== GUARANTEED_ARTICLE_PRICE_USD.toFixed(2) || capture.currency !== 'USD') {
        // Should be unreachable since the order was created server-side for
        // this exact amount, but never trust it without checking.
        console.error('[PAYPAL RECONCILIATION NEEDED] Captured amount mismatch', {
          paypal_order_id, captureId: capture.captureId, amount: capture.amount, currency: capture.currency,
        });
        return res.status(400).json({ message: "Payment amount mismatch" });
      }

      let imageUrl = null;
      if (req.files?.image?.[0]) {
        imageUrl = await uploadImage(req.files.image[0].buffer, 'submissions');
      }

      try {
        const result = await safeInsert({
          artist_name, email, title, content: content || null,
          youtube_url, spotify_url, soundcloud_url,
          apple_music_url, instagram_url, genre,
          image_url: imageUrl, document_url: null,
          genius_song_url: null, genius_lyrics: null,
          submission_type: 'guaranteed_article', payment_amount: GUARANTEED_ARTICLE_PRICE_CENTS,
          payment_id: capture.captureId, payment_status: 'completed', payment_provider: 'paypal',
          paypal_order_id, paypal_capture_id: capture.captureId, paid_at: new Date(),
        });

        sendOwnerNotification({
          artist_name, email, title, submission_type: 'guaranteed_article',
          payment_amount: GUARANTEED_ARTICLE_PRICE_CENTS, content,
          youtube_url, spotify_url, soundcloud_url,
          apple_music_url, instagram_url, genre, image_url: imageUrl,
        }).catch(err => console.error('Owner email error:', err));

        sendCustomerConfirmation({
          artist_name, email, submission_type: 'guaranteed_article',
          payment_amount: GUARANTEED_ARTICLE_PRICE_CENTS,
        }).catch(err => console.error('Customer email error:', err));

        res.status(201).json({
          message: "Payment successful. Your guaranteed Cry808 article submission has been received.",
          orderId: paypal_order_id,
          submission: result.rows[0],
        });
      } catch (dbError) {
        // Money has already been captured -- never let a DB failure lose
        // that fact. Logged clearly for manual reconciliation.
        console.error('[PAYPAL RECONCILIATION NEEDED] Capture succeeded but DB save failed', {
          paypal_order_id, captureId: capture.captureId,
          amount: capture.amount, currency: capture.currency,
          artist_name, email, error: dbError.message,
        });
        res.status(502).json({
          message: "Payment succeeded but we couldn't save your submission. Please contact support with this order ID.",
          orderId: paypal_order_id,
        });
      }
    } catch (error) {
      console.error('Error capturing PayPal order:', error.message);
      res.status(500).json({ message: "Payment could not be verified. Please try again or contact support." });
    }
  }
);

// ── @route GET /api/submissions ───────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM music_submissions ORDER BY created_at DESC');
    res.json({ submissions: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching submissions:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── @route POST /api/submissions/:id/publish ──────────────────────────────────
router.post("/:id/publish", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM music_submissions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ message: "Submission not found" });
    const sub = rows[0];
    if (sub.submission_status === 'approved') return res.status(400).json({ message: "Already published" });

    const article = await pool.query(
      `INSERT INTO articles (title, author, content, image_url, youtube_url, spotify_url, soundcloud_url, category, is_featured, site)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'article',$8,'cry808')
       RETURNING id, title, author, created_at`,
      [
        sub.title, sub.artist_name,
        sub.content || 'Content provided via submission.',
        sub.image_url, sub.youtube_url, sub.spotify_url, sub.soundcloud_url,
        sub.submission_type === 'featured',
      ]
    );

    await pool.query(
      'UPDATE music_submissions SET submission_status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
      ['approved', id]
    );

    res.json({ message: "Article published successfully", article: article.rows[0] });
  } catch (error) {
    console.error('Error publishing submission:', error.message);
    res.status(500).json({ message: "Failed to publish article" });
  }
});

// ── @route PUT /api/submissions/:id/status ────────────────────────────────────
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['pending','approved','rejected'].includes(status))
    return res.status(400).json({ message: "Invalid status" });

  try {
    const result = await pool.query(
      'UPDATE music_submissions SET submission_status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Submission not found" });
    res.json({ message: "Status updated", submission: result.rows[0] });
  } catch (error) {
    console.error('Error updating status:', error.message);
    res.status(500).json({ message: "Failed to update status" });
  }
});

export default router;
