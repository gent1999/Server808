import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import Stripe from "stripe";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import { sendOwnerNotification, sendCustomerConfirmation } from "../utils/email.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Multer ─────────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) return cb(null, true);
    if (file.fieldname === 'document') {
      const allowed = ['text/plain','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      return allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only txt, doc, docx, pdf allowed'), false);
    }
    cb(new Error('Invalid file type'), false);
  },
});

// ── Cloudinary helper ──────────────────────────────────────────────────────────
const uploadToCloudinary = (buffer, folder = 'submissions', resourceType = 'auto') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: resourceType }, (err, result) => {
      err ? reject(err) : resolve(result);
    });
    Readable.from(buffer).pipe(stream);
  });

// ── Shared fields for the full submit ─────────────────────────────────────────
const FULL_SUBMIT_FIELDS = upload.fields([
  { name: 'image',    maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

// ── All valid submission types ─────────────────────────────────────────────────
const ALL_TYPES    = ['free', 'regular', 'priority', 'featured', 'genius'];
const PAID_TYPES   = ['regular', 'priority', 'featured', 'genius'];

// ── Pricing map ────────────────────────────────────────────────────────────────
function getAmount(type) {
  if (type === 'featured') return 700; // legacy $7
  if (type === 'genius')   return 1000; // $10
  return 500; // regular / priority → $5
}

// @route   POST /api/submissions/create-payment-intent
// @desc    Create Stripe payment intent for paid submissions
// @access  Public
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
      const amount = getAmount(submission_type);

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
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

// @route   POST /api/submissions/free-submit
// @desc    Save a free (no-payment) music submission
// @access  Public
router.post(
  "/free-submit",
  FULL_SUBMIT_FIELDS,
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
      // Upload cover image if provided
      let imageUrl = null;
      if (req.files?.image?.[0]) {
        const result = await uploadToCloudinary(req.files.image[0].buffer, 'submissions', 'image');
        imageUrl = result.secure_url;
      }

      const result = await pool.query(
        `INSERT INTO music_submissions
          (artist_name, email, title, content,
           youtube_url, spotify_url, soundcloud_url, apple_music_url,
           instagram_url, genre, image_url,
           submission_type, payment_amount, payment_status, submission_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'free',0,'free','pending')
         RETURNING id, artist_name, email, title, submission_type, created_at`,
        [
          artist_name, email, title, content,
          youtube_url || null, spotify_url || null, soundcloud_url || null, apple_music_url || null,
          instagram_url || null, genre || null, imageUrl,
        ]
      );

      // Notify owner (fire-and-forget)
      sendOwnerNotification({
        artist_name, email, title, submission_type: 'free',
        payment_amount: 0, content,
        youtube_url, spotify_url, soundcloud_url, apple_music_url, instagram_url, genre,
        image_url: imageUrl,
      }).catch(err => console.error('Owner email error:', err));

      sendCustomerConfirmation({
        artist_name, email,
        submission_type: 'free',
        payment_amount: 0,
      }).catch(err => console.error('Customer email error:', err));

      res.status(201).json({
        message: "Free submission received! We'll review your music and get back to you soon.",
        submission: result.rows[0],
      });
    } catch (error) {
      console.error('Error saving free submission:', error.message);
      res.status(500).json({ message: "Failed to save submission" });
    }
  }
);

// @route   POST /api/submissions/submit
// @desc    Save paid music submission after successful Stripe payment
// @access  Public
router.post(
  "/submit",
  FULL_SUBMIT_FIELDS,
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
      // Verify payment
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_id);
      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ message: "Payment not completed" });
      }

      // Upload image
      let imageUrl = null;
      if (req.files?.image?.[0]) {
        const result = await uploadToCloudinary(req.files.image[0].buffer, 'submissions', 'image');
        imageUrl = result.secure_url;
      }

      // Upload document (for legacy regular/featured submissions)
      let documentUrl = null;
      if (req.files?.document?.[0]) {
        const result = await uploadToCloudinary(req.files.document[0].buffer, 'submissions', 'raw');
        documentUrl = result.secure_url;
      }

      const result = await pool.query(
        `INSERT INTO music_submissions
          (artist_name, email, title, content,
           youtube_url, spotify_url, soundcloud_url, apple_music_url,
           instagram_url, genre, image_url, document_url,
           genius_song_url, genius_lyrics,
           submission_type, payment_amount, payment_id, payment_status, submission_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'completed','pending')
         RETURNING id, artist_name, email, title, submission_type, created_at`,
        [
          artist_name, email, title, content || null,
          youtube_url || null, spotify_url || null, soundcloud_url || null, apple_music_url || null,
          instagram_url || null, genre || null, imageUrl, documentUrl,
          genius_song_url || null, genius_lyrics || null,
          submission_type, paymentIntent.amount, payment_id,
        ]
      );

      // Emails
      sendOwnerNotification({
        artist_name, email, title, submission_type,
        payment_amount: paymentIntent.amount, content,
        youtube_url, spotify_url, soundcloud_url, apple_music_url,
        instagram_url, genre, image_url: imageUrl, document_url: documentUrl,
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
      console.error('Error saving paid submission:', error.message);
      res.status(500).json({ message: "Failed to save submission" });
    }
  }
);

// @route   GET /api/submissions
// @desc    Get all submissions (admin)
// @access  Private
router.get("/", async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM music_submissions ORDER BY created_at DESC');
    res.json({ submissions: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching submissions:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/submissions/:id/publish
// @desc    Publish a submission as an article
// @access  Private
router.post("/:id/publish", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM music_submissions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ message: "Submission not found" });
    const sub = rows[0];
    if (sub.submission_status === 'approved') return res.status(400).json({ message: "Already published" });

    const article = await pool.query(
      `INSERT INTO articles (title, author, content, image_url, youtube_url, spotify_url, soundcloud_url, category, is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'article',$8)
       RETURNING id, title, author, created_at`,
      [
        sub.title,
        sub.artist_name,
        sub.content || 'Content provided via submission.',
        sub.image_url,
        sub.youtube_url,
        sub.spotify_url,
        sub.soundcloud_url,
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

// @route   PUT /api/submissions/:id/status
// @desc    Update submission status
// @access  Private
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status))
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
