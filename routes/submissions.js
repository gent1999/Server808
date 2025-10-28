import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import Stripe from "stripe";
import { sendOwnerNotification, sendCustomerConfirmation } from "../utils/email.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  [
    body("artist_name").trim().notEmpty().withMessage("Artist name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("content").trim().notEmpty().withMessage("Content is required"),
    body("payment_id").trim().notEmpty().withMessage("Payment ID is required"),
    body("submission_type").isIn(['regular', 'featured']).withMessage("Invalid submission type"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { artist_name, email, content, youtube_url, spotify_url, payment_id, submission_type } = req.body;

    try {
      // Verify payment with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_id);

      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ message: "Payment not completed" });
      }

      // Get payment amount from payment intent
      const payment_amount = paymentIntent.amount;

      // Save submission to database
      const result = await pool.query(
        `INSERT INTO music_submissions (artist_name, email, content, youtube_url, spotify_url, submission_type, payment_amount, payment_id, payment_status, submission_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, artist_name, email, submission_type, created_at`,
        [artist_name, email, content, youtube_url || null, spotify_url || null, submission_type, payment_amount, payment_id, 'completed', 'pending']
      );

      // Send email notifications (don't wait for them, send async)
      sendOwnerNotification({
        artist_name,
        email,
        submission_type,
        payment_amount,
        content,
        youtube_url,
        spotify_url,
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

export default router;
