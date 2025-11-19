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

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images for the image field
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    }
    // Allow documents (txt, doc, docx, pdf) for the document field
    else if (file.fieldname === 'document') {
      const allowedMimeTypes = [
        'text/plain',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only txt, doc, docx, and pdf files are allowed for documents!'), false);
      }
    }
    else {
      cb(new Error('Invalid file type!'), false);
    }
  }
});

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (buffer, folder = 'submissions', resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: resourceType
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    const readableStream = Readable.from(buffer);
    readableStream.pipe(uploadStream);
  });
};

// @route   POST /api/submissions/create-payment-intent
// @desc    Create a Stripe payment intent for music submission
// @access  Public
router.post(
  "/create-payment-intent",
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("content").trim().notEmpty().withMessage("Content is required"),
    body("submission_type").isIn(['regular', 'featured']).withMessage("Invalid submission type"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { submission_type } = req.body;

      // Set price based on submission type
      const amount = submission_type === 'featured' ? 700 : 500; // $7 for featured, $5 for regular

      // Create payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
        receipt_email: req.body.email, // Automatically send Stripe receipt
        metadata: {
          artist_name: req.body.artist_name,
          email: req.body.email,
          submission_type: submission_type,
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error) {
      console.error('Error creating payment intent:', error.message);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  }
);

// @route   POST /api/submissions/submit
// @desc    Save music submission after successful payment
// @access  Public
router.post(
  "/submit",
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("title").trim().notEmpty().withMessage("Title is required"),
    // Content is optional if document is provided
    body("payment_id").trim().notEmpty().withMessage("Payment ID is required"),
    body("submission_type").isIn(['regular', 'featured']).withMessage("Invalid submission type"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { artist_name, email, title, content, youtube_url, spotify_url, soundcloud_url, payment_id, submission_type } = req.body;

    try {
      // Validate that either content or document is provided
      const hasContent = content && content.trim().length > 0;
      const hasDocument = req.files && req.files['document'] && req.files['document'].length > 0;

      if (!hasContent && !hasDocument) {
        return res.status(400).json({ message: "Either content text or document file is required" });
      }

      // If content is provided, validate length
      if (hasContent && (content.trim().length < 300 || content.trim().length > 5000)) {
        return res.status(400).json({ message: "Content must be between 300 and 5000 characters" });
      }

      // Verify payment with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_id);

      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ message: "Payment not completed" });
      }

      // Get payment amount from payment intent
      const payment_amount = paymentIntent.amount;

      // Upload image to Cloudinary if provided
      let imageUrl = null;
      if (req.files && req.files['image'] && req.files['image'].length > 0) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer, 'submissions', 'image');
          imageUrl = uploadResult.secure_url;
          console.log('Image uploaded to Cloudinary (submissions folder):', imageUrl);
        } catch (uploadError) {
          console.error('Cloudinary image upload error:', uploadError);
          return res.status(500).json({ message: "Failed to upload image" });
        }
      }

      // Upload document to Cloudinary if provided
      let documentUrl = null;
      if (hasDocument) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['document'][0].buffer, 'submissions', 'raw');
          documentUrl = uploadResult.secure_url;
          console.log('Document uploaded to Cloudinary (submissions folder):', documentUrl);
        } catch (uploadError) {
          console.error('Cloudinary document upload error:', uploadError);
          return res.status(500).json({ message: "Failed to upload document" });
        }
      }

      // Save submission to database
      const result = await pool.query(
        `INSERT INTO music_submissions (artist_name, email, title, content, youtube_url, spotify_url, soundcloud_url, image_url, document_url, submission_type, payment_amount, payment_id, payment_status, submission_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, artist_name, email, title, submission_type, created_at`,
        [artist_name, email, title, content || null, youtube_url || null, spotify_url || null, soundcloud_url || null, imageUrl, documentUrl, submission_type, payment_amount, payment_id, 'completed', 'pending']
      );

      // Send email notifications (don't wait for them, send async)
      sendOwnerNotification({
        artist_name,
        email,
        title,
        submission_type,
        payment_amount,
        content,
        youtube_url,
        spotify_url,
        soundcloud_url,
        image_url: imageUrl,
        document_url: documentUrl,
      }).catch(err => console.error('Error sending owner notification:', err));

      sendCustomerConfirmation({
        artist_name,
        email,
        submission_type,
        payment_amount,
      }).catch(err => console.error('Error sending customer confirmation:', err));

      res.status(201).json({
        message: "Submission received successfully! We'll review it and get back to you soon.",
        submission: result.rows[0]
      });
    } catch (error) {
      console.error('Error saving submission:', error.message);
      res.status(500).json({ message: "Failed to save submission" });
    }
  }
);

// @route   GET /api/submissions
// @desc    Get all submissions (admin only - would need auth middleware)
// @access  Private
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM music_submissions ORDER BY created_at DESC'
    );

    res.json({
      submissions: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching submissions:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/submissions/:id/publish
// @desc    Publish a submission as an article
// @access  Private (admin only)
router.post("/:id/publish", async (req, res) => {
  const { id } = req.params;

  try {
    // Get submission details
    const submissionResult = await pool.query(
      'SELECT * FROM music_submissions WHERE id = $1',
      [id]
    );

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: "Submission not found" });
    }

    const submission = submissionResult.rows[0];

    // Check if already published
    if (submission.submission_status === 'approved') {
      return res.status(400).json({ message: "Submission already published" });
    }

    // Create article from submission
    const articleResult = await pool.query(
      `INSERT INTO articles (title, author, content, image_url, youtube_url, spotify_url, soundcloud_url, category, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, author, created_at`,
      [
        submission.title,
        submission.artist_name,
        submission.content || 'Content provided via document upload. Please check submission details.',
        submission.image_url,
        submission.youtube_url,
        submission.spotify_url,
        submission.soundcloud_url,
        'article',
        submission.submission_type === 'featured'
      ]
    );

    // Update submission status to approved
    await pool.query(
      'UPDATE music_submissions SET submission_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['approved', id]
    );

    res.json({
      message: "Article published successfully",
      article: articleResult.rows[0]
    });
  } catch (error) {
    console.error('Error publishing submission:', error.message);
    res.status(500).json({ message: "Failed to publish article" });
  }
});

// @route   PUT /api/submissions/:id/status
// @desc    Update submission status
// @access  Private (admin only)
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Validate status
  const validStatuses = ['pending', 'approved', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    const result = await pool.query(
      'UPDATE music_submissions SET submission_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Submission not found" });
    }

    res.json({
      message: "Status updated successfully",
      submission: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating submission status:', error.message);
    res.status(500).json({ message: "Failed to update status" });
  }
});

export default router;
