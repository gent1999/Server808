import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import auth from "../middleware/auth.js";

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit per file
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (buffer, folder = 'lowkeygrid') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'auto'
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

// GET /api/lowkeygrid/articles/admin/all - Get ALL LowkeyGrid articles (admin only)
router.get("/admin/all", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM articles WHERE site = 'lowkeygrid' ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/lowkeygrid/articles - Get all LowkeyGrid 'trends' articles (public)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM articles WHERE site = 'lowkeygrid' AND category = 'trends' ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/lowkeygrid/articles/writeups - Get all 'article' and 'interview' from both sites (public)
router.get("/writeups", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM articles WHERE category IN ('article', 'interview') ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching writeups:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/lowkeygrid/articles/admin/:id - Get single article for admin (protected)
router.get("/admin/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM articles WHERE id = $1 AND site = 'lowkeygrid'",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/lowkeygrid/articles/:id - Get single article (public - trends from lowkeygrid, or article/interview from any site)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM articles WHERE id = $1 AND (category = 'trends' OR category IN ('article', 'interview'))",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/lowkeygrid/articles - Create new article (protected)
router.post(
  "/",
  auth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("author").trim().notEmpty().withMessage("Author is required"),
    body("content").trim().notEmpty().withMessage("Content is required")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, author, content, tags, category, instagram_link } = req.body;

      let imageUrl = null;
      let thumbnailUrl = null;

      // Upload original image to Cloudinary if provided
      if (req.files && req.files['image'] && req.files['image'][0]) {
        const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
        imageUrl = uploadResult.secure_url;
      }

      // Upload thumbnail (cropped) to Cloudinary if provided
      if (req.files && req.files['thumbnail'] && req.files['thumbnail'][0]) {
        const uploadResult = await uploadToCloudinary(req.files['thumbnail'][0].buffer, 'lowkeygrid/thumbnails');
        thumbnailUrl = uploadResult.secure_url;
      }

      // Parse tags if provided as string
      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      // Insert article with site='lowkeygrid'
      const result = await pool.query(
        `INSERT INTO articles (title, author, content, image_url, thumbnail_url, tags, category, site, instagram_link)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'lowkeygrid', $8)
         RETURNING *`,
        [title, author, content, imageUrl, thumbnailUrl, tagsArray, category || 'trends', instagram_link || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating article:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// PUT /api/lowkeygrid/articles/:id - Update article (protected)
router.put(
  "/:id",
  auth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("author").trim().notEmpty().withMessage("Author is required"),
    body("content").trim().notEmpty().withMessage("Content is required")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { title, author, content, tags, category, instagram_link } = req.body;

      // Check if article exists and belongs to lowkeygrid
      const existingArticle = await pool.query(
        "SELECT * FROM articles WHERE id = $1 AND site = 'lowkeygrid'",
        [id]
      );

      if (existingArticle.rows.length === 0) {
        return res.status(404).json({ error: "Article not found" });
      }

      let imageUrl = existingArticle.rows[0].image_url;
      let thumbnailUrl = existingArticle.rows[0].thumbnail_url;

      // Helper to delete old Cloudinary image
      const deleteCloudinaryImage = async (url) => {
        if (!url) return;
        const urlParts = url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
        const publicId = publicIdWithFolder.split('.')[0];
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (error) {
          console.error('Error deleting old image:', error);
        }
      };

      // If new original image uploaded, replace old one
      if (req.files && req.files['image'] && req.files['image'][0]) {
        await deleteCloudinaryImage(existingArticle.rows[0].image_url);
        const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
        imageUrl = uploadResult.secure_url;
      }

      // If new thumbnail uploaded, replace old one
      if (req.files && req.files['thumbnail'] && req.files['thumbnail'][0]) {
        await deleteCloudinaryImage(existingArticle.rows[0].thumbnail_url);
        const uploadResult = await uploadToCloudinary(req.files['thumbnail'][0].buffer, 'lowkeygrid/thumbnails');
        thumbnailUrl = uploadResult.secure_url;
      }

      // Parse tags
      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      // Update article
      const result = await pool.query(
        `UPDATE articles
         SET title = $1, author = $2, content = $3, image_url = $4, thumbnail_url = $5, tags = $6, category = $7, instagram_link = $8, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9 AND site = 'lowkeygrid'
         RETURNING *`,
        [title, author, content, imageUrl, thumbnailUrl, tagsArray, category || 'trends', instagram_link || null, id]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating article:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// DELETE /api/lowkeygrid/articles/:id - Delete any LowkeyGrid article (protected)
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get article to delete image from Cloudinary (any category allowed for delete)
    const article = await pool.query(
      "SELECT * FROM articles WHERE id = $1 AND site = 'lowkeygrid'",
      [id]
    );

    if (article.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    // Delete images from Cloudinary if they exist
    const deleteCloudinaryImage = async (url) => {
      if (!url) return;
      const urlParts = url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
      const publicId = publicIdWithFolder.split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        console.error('Error deleting image from Cloudinary:', error);
      }
    };

    await deleteCloudinaryImage(article.rows[0].image_url);
    await deleteCloudinaryImage(article.rows[0].thumbnail_url);

    // Delete from database
    await pool.query("DELETE FROM articles WHERE id = $1 AND site = 'lowkeygrid'", [id]);

    res.json({ message: "Article deleted successfully" });
  } catch (error) {
    console.error("Error deleting article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
