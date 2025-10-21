import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";

const router = express.Router();

// @route   POST /api/articles
// @desc    Create a new article
// @access  Private (requires admin authentication)
router.post(
  "/",
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("author").trim().notEmpty().withMessage("Author is required"),
    body("content").trim().notEmpty().withMessage("Content is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, author, content, tags } = req.body;

    try {
      // Parse tags if it's a string (from FormData)
      let tagsArray = [];
      if (tags) {
        if (typeof tags === 'string') {
          tagsArray = JSON.parse(tags);
        } else if (Array.isArray(tags)) {
          tagsArray = tags;
        }
      }

      // Insert article into database
      const result = await pool.query(
        `INSERT INTO articles (title, author, content, tags)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, author, content, tags, created_at, updated_at`,
        [title, author, content, tagsArray]
      );

      const newArticle = result.rows[0];

      res.status(201).json({
        message: "Article created successfully",
        article: newArticle
      });
    } catch (error) {
      console.error('Error creating article:', error.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// @route   GET /api/articles
// @desc    Get all articles
// @access  Public
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, author, content, image_url, tags, created_at, updated_at FROM articles ORDER BY created_at DESC'
    );

    res.json({
      articles: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching articles:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/articles/:id
// @desc    Get single article by ID
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT id, title, author, content, image_url, tags, created_at, updated_at FROM articles WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json({
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/articles/:id
// @desc    Update an article
// @access  Private (requires admin authentication)
router.put(
  "/:id",
  [
    body("title").optional().trim().notEmpty().withMessage("Title cannot be empty"),
    body("author").optional().trim().notEmpty().withMessage("Author cannot be empty"),
    body("content").optional().trim().notEmpty().withMessage("Content cannot be empty"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, author, content, tags } = req.body;

    try {
      // Check if article exists
      const checkResult = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ message: "Article not found" });
      }

      // Parse tags if it's a string (from FormData)
      let tagsArray = [];
      if (tags) {
        if (typeof tags === 'string') {
          tagsArray = JSON.parse(tags);
        } else if (Array.isArray(tags)) {
          tagsArray = tags;
        }
      }

      // Update article
      const result = await pool.query(
        `UPDATE articles
         SET title = COALESCE($1, title),
             author = COALESCE($2, author),
             content = COALESCE($3, content),
             tags = COALESCE($4, tags),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, title, author, content, tags, created_at, updated_at`,
        [title || null, author || null, content || null, tagsArray.length > 0 ? tagsArray : null, id]
      );

      res.json({
        message: "Article updated successfully",
        article: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating article:', error.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// @route   DELETE /api/articles/:id
// @desc    Delete an article
// @access  Private (requires admin authentication)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM articles WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json({
      message: "Article deleted successfully",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
