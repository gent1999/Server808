import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import auth from "../middleware/auth.js";
import { purgeNewsItemCreated, purgeNewsItemUpdated, purgeNewsItemDeleted, purgeHome } from "../utils/koverallsPurge.js";

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
const uploadToCloudinary = (buffer, folder = 'koveralls-articles') => {
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

// GET /api/koveralls-articles/admin/all - Get ALL native 2koveralls write-ups (admin only)
router.get("/admin/all", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM koveralls_articles ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching koveralls articles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/koveralls-articles - Get all native 2koveralls write-ups (public)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM koveralls_articles ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching koveralls articles:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/koveralls-articles/:id/feature - Set as the featured write-up (protected)
router.put("/:id/feature", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const check = await pool.query("SELECT id FROM koveralls_articles WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    // Only one write-up can be featured at a time
    await pool.query("UPDATE koveralls_articles SET is_featured = false WHERE is_featured = true");

    const result = await pool.query(
      "UPDATE koveralls_articles SET is_featured = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );

    await purgeHome();
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error setting featured article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/koveralls-articles/:id/feature - Remove featured status (protected)
router.delete("/:id/feature", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE koveralls_articles SET is_featured = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }
    await purgeHome();
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error removing featured article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/koveralls-articles/featured/article - Get the featured write-up (public)
router.get("/featured/article", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM koveralls_articles WHERE is_featured = true LIMIT 1"
    );
    res.json({ article: result.rows[0] || null });
  } catch (error) {
    console.error("Error fetching featured article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/koveralls-articles/admin/:id - Get single article for admin (protected)
router.get("/admin/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM koveralls_articles WHERE id = $1",
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

// GET /api/koveralls-articles/:id - Get single article (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM koveralls_articles WHERE id = $1",
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

// POST /api/koveralls-articles - Create new write-up (protected)
router.post(
  "/",
  auth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("content").trim().notEmpty().withMessage("Content is required")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, author, content, tags, category, instagram_link, spotify_url, youtube_url, soundcloud_url } = req.body;

      let imageUrl = null;
      let thumbnailUrl = null;

      if (req.files && req.files['image'] && req.files['image'][0]) {
        const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
        imageUrl = uploadResult.secure_url;
      }

      if (req.files && req.files['thumbnail'] && req.files['thumbnail'][0]) {
        const uploadResult = await uploadToCloudinary(req.files['thumbnail'][0].buffer, 'koveralls-articles/thumbnails');
        thumbnailUrl = uploadResult.secure_url;
      }

      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      const result = await pool.query(
        `INSERT INTO koveralls_articles (title, author, content, image_url, thumbnail_url, tags, category, instagram_link, spotify_url, youtube_url, soundcloud_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [title, author || null, content, imageUrl, thumbnailUrl, tagsArray, category || 'article', instagram_link || null, spotify_url || null, youtube_url || null, soundcloud_url || null]
      );

      await purgeNewsItemCreated(result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating koveralls article:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// PUT /api/koveralls-articles/:id - Update write-up (protected)
router.put(
  "/:id",
  auth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("content").trim().notEmpty().withMessage("Content is required")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { title, author, content, tags, category, instagram_link, spotify_url, youtube_url, soundcloud_url } = req.body;

      const existingArticle = await pool.query(
        "SELECT * FROM koveralls_articles WHERE id = $1",
        [id]
      );

      if (existingArticle.rows.length === 0) {
        return res.status(404).json({ error: "Article not found" });
      }

      let imageUrl = existingArticle.rows[0].image_url;
      let thumbnailUrl = existingArticle.rows[0].thumbnail_url;

      if (req.files && req.files['image'] && req.files['image'][0]) {
        await deleteCloudinaryImage(existingArticle.rows[0].image_url);
        const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
        imageUrl = uploadResult.secure_url;
      }

      if (req.files && req.files['thumbnail'] && req.files['thumbnail'][0]) {
        await deleteCloudinaryImage(existingArticle.rows[0].thumbnail_url);
        const uploadResult = await uploadToCloudinary(req.files['thumbnail'][0].buffer, 'koveralls-articles/thumbnails');
        thumbnailUrl = uploadResult.secure_url;
      }

      let tagsArray = null;
      if (tags) {
        tagsArray = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      }

      const result = await pool.query(
        `UPDATE koveralls_articles
         SET title = $1, author = $2, content = $3, image_url = $4, thumbnail_url = $5, tags = $6, category = $7, instagram_link = $8,
             spotify_url = $9, youtube_url = $10, soundcloud_url = $11, updated_at = CURRENT_TIMESTAMP
         WHERE id = $12
         RETURNING *`,
        [title, author || null, content, imageUrl, thumbnailUrl, tagsArray, category || 'article', instagram_link || null, spotify_url || null, youtube_url || null, soundcloud_url || null, id]
      );

      await purgeNewsItemUpdated(existingArticle.rows[0], result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating koveralls article:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// DELETE /api/koveralls-articles/:id - Delete write-up (protected)
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const article = await pool.query(
      "SELECT * FROM koveralls_articles WHERE id = $1",
      [id]
    );

    if (article.rows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    await deleteCloudinaryImage(article.rows[0].image_url);
    await deleteCloudinaryImage(article.rows[0].thumbnail_url);

    await pool.query("DELETE FROM koveralls_articles WHERE id = $1", [id]);

    await purgeNewsItemDeleted(article.rows[0]);
    res.json({ message: "Article deleted successfully" });
  } catch (error) {
    console.error("Error deleting koveralls article:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
