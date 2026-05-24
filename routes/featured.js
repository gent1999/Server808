import express from "express";
import pool from "../config/db.js";

const router = express.Router();

const MAX_FEATURED = 5;

// @route   PUT /api/featured/:id
// @desc    Add an article to the featured carousel (up to 5 slots)
// @access  Private (requires admin authentication)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check article exists
    const checkResult = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Check if already featured
    if (checkResult.rows[0].is_featured) {
      return res.json({ message: "Article is already featured", article: checkResult.rows[0] });
    }

    // Enforce max cap
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM articles WHERE is_featured = true AND site = 'cry808'"
    );
    if (parseInt(countResult.rows[0].count) >= MAX_FEATURED) {
      return res.status(400).json({
        message: `Carousel is full (${MAX_FEATURED} max). Remove a featured article first.`
      });
    }

    // Set this article as featured (others unchanged)
    const result = await pool.query(
      'UPDATE articles SET is_featured = true WHERE id = $1 RETURNING id, title, is_featured',
      [id]
    );

    res.json({
      message: "Article added to featured carousel",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error setting featured article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/featured/:id
// @desc    Remove an article from the featured carousel
// @access  Private (requires admin authentication)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE articles SET is_featured = false WHERE id = $1 RETURNING id, title, is_featured',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json({
      message: "Article removed from featured carousel",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error removing featured article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
