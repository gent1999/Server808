import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";

const router = express.Router();

// @route   POST /api/newsletter/subscribe
// @desc    Subscribe to newsletter
// @access  Public
router.post(
  "/subscribe",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Please provide a valid email address")
      .normalizeEmail(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    try {
      // Check if email already exists
      const existingSubscriber = await pool.query(
        'SELECT * FROM newsletter_subscribers WHERE email = $1',
        [email]
      );

      if (existingSubscriber.rows.length > 0) {
        // Check if previously unsubscribed
        if (!existingSubscriber.rows[0].is_active) {
          // Reactivate subscription
          await pool.query(
            'UPDATE newsletter_subscribers SET is_active = true, subscribed_at = CURRENT_TIMESTAMP WHERE email = $1',
            [email]
          );
          return res.status(200).json({
            message: "Welcome back! Your subscription has been reactivated."
          });
        } else {
          return res.status(400).json({
            message: "This email is already subscribed to our newsletter."
          });
        }
      }

      // Insert new subscriber
      const result = await pool.query(
        `INSERT INTO newsletter_subscribers (email)
         VALUES ($1)
         RETURNING id, email, subscribed_at, is_active`,
        [email]
      );

      const newSubscriber = result.rows[0];

      res.status(201).json({
        message: "Successfully subscribed to the newsletter!",
        subscriber: {
          email: newSubscriber.email,
          subscribed_at: newSubscriber.subscribed_at
        }
      });
    } catch (error) {
      console.error('Error subscribing to newsletter:', error.message);
      res.status(500).json({ message: "Server error. Please try again later." });
    }
  }
);

// @route   GET /api/newsletter/subscribers
// @desc    Get all newsletter subscribers (admin only)
// @access  Private
router.get("/subscribers", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, subscribed_at, is_active FROM newsletter_subscribers ORDER BY subscribed_at DESC'
    );

    res.json({
      subscribers: result.rows,
      count: result.rows.length,
      active_count: result.rows.filter(s => s.is_active).length
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/newsletter/unsubscribe/:email
// @desc    Unsubscribe from newsletter
// @access  Public
router.delete("/unsubscribe/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const result = await pool.query(
      'UPDATE newsletter_subscribers SET is_active = false WHERE email = $1 RETURNING *',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Email not found in our subscriber list." });
    }

    res.json({
      message: "Successfully unsubscribed from the newsletter."
    });
  } catch (error) {
    console.error('Error unsubscribing:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
