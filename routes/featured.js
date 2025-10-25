import express from "express";
import pool from "../config/db.js";

const router = express.Router();

// @route   PUT /api/featured/:id
// @desc    Set an article as featured (unsets all others)
// @access  Private (requires admin authentication)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // First, check if article exists
    const checkResult = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Unset all other featured articles
    await pool.query('UPDATE articles SET is_featured = false WHERE is_featured = true');

    // Set this article as featured
    const result = await pool.query(
      'UPDATE articles SET is_featured = true WHERE id = $1 RETURNING id, title, is_featured',
      [id]
    );

    res.json({
      message: "Article set as featured",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error setting featured article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/featured/:id
// @desc    Unset an article as featured
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
      message: "Article removed from featured",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error removing featured article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
