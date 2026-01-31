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

// GET /api/lowkeygrid/articles/:id - Get single 'trends' article (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM articles WHERE id = $1 AND site = 'lowkeygrid' AND category = 'trends'",
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
  upload.single('image'),
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
      const { title, author, content, tags, category } = req.body;

      let imageUrl = null;

      // Upload image to Cloudinary if provided
      if (req.file) {
        const uploadResult = await uploadToCloudinary(req.file.buffer);
        imageUrl = uploadResult.secure_url;
      }

      // Parse tags if provided as string
      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      // Insert article with site='lowkeygrid'
      const result = await pool.query(
        `INSERT INTO articles (title, author, content, image_url, tags, category, site)
         VALUES ($1, $2, $3, $4, $5, $6, 'lowkeygrid')
         RETURNING *`,
        [title, author, content, imageUrl, tagsArray, category || 'trends']
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
  upload.single('image'),
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
      const { title, author, content, tags, category } = req.body;

      // Check if article exists and belongs to lowkeygrid
      const existingArticle = await pool.query(
        "SELECT * FROM articles WHERE id = $1 AND site = 'lowkeygrid'",
        [id]
      );

      if (existingArticle.rows.length === 0) {
        return res.status(404).json({ error: "Article not found" });
      }

      let imageUrl = existingArticle.rows[0].image_url;

      // If new image uploaded, replace old one
      if (req.file) {
        // Delete old image from Cloudinary if exists
        if (existingArticle.rows[0].image_url) {
          const urlParts = existingArticle.rows[0].image_url.split('/');
          const uploadIndex = urlParts.indexOf('upload');
          const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
          const publicId = publicIdWithFolder.split('.')[0];

          try {
            await cloudinary.uploader.destroy(publicId);
          } catch (error) {
            console.error('Error deleting old image:', error);
          }
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(req.file.buffer);
        imageUrl = uploadResult.secure_url;
      }

      // Parse tags
      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      // Update article
      const result = await pool.query(
        `UPDATE articles
         SET title = $1, author = $2, content = $3, image_url = $4, tags = $5, category = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 AND site = 'lowkeygrid'
         RETURNING *`,
        [title, author, content, imageUrl, tagsArray, category || 'trends', id]
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

    // Delete image from Cloudinary if exists
    if (article.rows[0].image_url) {
      const urlParts = article.rows[0].image_url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
      const publicId = publicIdWithFolder.split('.')[0];

      try {
        await cloudinary.uploader.destroy(publicId);
        console.log('Image deleted from Cloudinary');
      } catch (error) {
        console.error('Error deleting image from Cloudinary:', error);
      }
    }

    // Delete from database
    await pool.query("DELETE FROM articles WHERE id = $1 AND site = 'lowkeygrid'", [id]);

    res.json({ message: "Article deleted successfully" });
  } catch (error) {
    console.error("Error deleting article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
