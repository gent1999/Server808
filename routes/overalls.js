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
    fileSize: 5 * 1024 * 1024 // 5MB limit
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
const uploadToCloudinary = (buffer, folder = '2k-overalls') => {
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

// Helper function to generate slug from title
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

// GET /api/overalls - Get all overalls (public)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM overalls ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching overalls:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/:id - Get single overall by ID (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM overalls WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching overall:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/slug/:slug - Get overall by slug (public)
router.get("/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query(
      "SELECT * FROM overalls WHERE slug = $1",
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching overall:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/overalls - Create new overall (protected)
router.post(
  "/",
  auth,
  upload.single('image'),
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
      const { title, content, overall } = req.body;

      // Check if image was uploaded
      if (!req.file) {
        return res.status(400).json({ error: "Image is required" });
      }

      // Upload image to Cloudinary
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      const imageUrl = uploadResult.secure_url;

      // Generate slug from title
      let slug = generateSlug(title);

      // Check if slug already exists, if so, append a number
      let slugExists = true;
      let counter = 1;
      let finalSlug = slug;

      while (slugExists) {
        const existingSlug = await pool.query(
          "SELECT id FROM overalls WHERE slug = $1",
          [finalSlug]
        );

        if (existingSlug.rows.length === 0) {
          slugExists = false;
        } else {
          finalSlug = `${slug}-${counter}`;
          counter++;
        }
      }

      // Insert into database
      const result = await pool.query(
        `INSERT INTO overalls (title, image_url, content, slug, overall)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [title, imageUrl, content, finalSlug, overall || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating overall:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// PUT /api/overalls/:id - Update overall (protected)
router.put(
  "/:id",
  auth,
  upload.single('image'),
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
      const { title, content, overall } = req.body;

      // Check if overall exists
      const existingOverall = await pool.query(
        "SELECT * FROM overalls WHERE id = $1",
        [id]
      );

      if (existingOverall.rows.length === 0) {
        return res.status(404).json({ error: "Overall not found" });
      }

      let imageUrl = existingOverall.rows[0].image_url;

      // If new image was uploaded, upload to Cloudinary and delete old one
      if (req.file) {
        // Delete old image from Cloudinary
        const oldImageUrl = existingOverall.rows[0].image_url;
        const urlParts = oldImageUrl.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
        const publicId = publicIdWithFolder.split('.')[0];

        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (error) {
          console.error('Error deleting old image from Cloudinary:', error);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(req.file.buffer);
        imageUrl = uploadResult.secure_url;
      }

      // Generate new slug if title changed
      let slug = existingOverall.rows[0].slug;
      if (title !== existingOverall.rows[0].title) {
        slug = generateSlug(title);

        // Check if new slug already exists (excluding current overall)
        let slugExists = true;
        let counter = 1;
        let finalSlug = slug;

        while (slugExists) {
          const existingSlug = await pool.query(
            "SELECT id FROM overalls WHERE slug = $1 AND id != $2",
            [finalSlug, id]
          );

          if (existingSlug.rows.length === 0) {
            slugExists = false;
          } else {
            finalSlug = `${slug}-${counter}`;
            counter++;
          }
        }
        slug = finalSlug;
      }

      // Update overall
      const result = await pool.query(
        `UPDATE overalls
         SET title = $1, image_url = $2, content = $3, slug = $4, overall = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [title, imageUrl, content, slug, overall || null, id]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating overall:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// DELETE /api/overalls/:id - Delete overall (protected)
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get overall to delete image from Cloudinary
    const overall = await pool.query(
      "SELECT * FROM overalls WHERE id = $1",
      [id]
    );

    if (overall.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    // Delete image from Cloudinary
    const imageUrl = overall.rows[0].image_url;
    const urlParts = imageUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
    const publicId = publicIdWithFolder.split('.')[0];

    try {
      await cloudinary.uploader.destroy(publicId);
      console.log('Image deleted from Cloudinary');
    } catch (error) {
      console.error('Error deleting image from Cloudinary:', error);
    }

    // Delete from database
    await pool.query("DELETE FROM overalls WHERE id = $1", [id]);

    res.json({ message: "Overall deleted successfully" });
  } catch (error) {
    console.error("Error deleting overall:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
