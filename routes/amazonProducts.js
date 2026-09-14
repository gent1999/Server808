import express from "express";
import pool from "../config/db.js";
import auth from "../middleware/auth.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

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
const uploadToCloudinary = (buffer, folder = 'amazon_images') => {
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

// @route   GET /api/amazon-products
// @desc    Get all active Amazon products (public), optionally filtered by page
// @access  Public
router.get("/", async (req, res) => {
  try {
    const { page } = req.query; // 'home' or 'article'

    let query = "SELECT * FROM amazon_products WHERE is_active = true";
    const params = [];

    // Filter by page if specified
    if (page === 'home') {
      query += " AND show_on_home = true";
    } else if (page === 'article') {
      query += " AND show_on_article = true";
    }

    query += " ORDER BY display_order ASC, created_at DESC";

    const result = await pool.query(query, params);

    res.json({
      products: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error("Error fetching Amazon products:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/amazon-products/mobile-featured
// @desc    Get mobile featured Amazon product (public)
// @access  Public
router.get("/mobile-featured", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM amazon_products WHERE is_mobile_featured = true AND is_active = true LIMIT 1"
    );

    res.json({
      product: result.rows[0] || null
    });
  } catch (error) {
    console.error("Error fetching mobile featured Amazon product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/amazon-products/admin
// @desc    Get all Amazon products (admin)
// @access  Private
router.get("/admin", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM amazon_products ORDER BY display_order ASC, created_at DESC"
    );

    res.json({
      products: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error("Error fetching Amazon products:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/amazon-products/admin
// @desc    Create a new Amazon product
// @access  Private
router.post("/admin", auth, upload.single('image'), async (req, res) => {
  try {
    const { name, description, affiliate_link, is_active, display_order, is_mobile_featured, show_on_home, show_on_article } = req.body;

    if (!name || !affiliate_link) {
      return res.status(400).json({ message: "Name and affiliate link are required" });
    }

    let imageUrl = null;

    // Upload image to Cloudinary if file is provided
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'amazon_images');
        imageUrl = uploadResult.secure_url;
        console.log('Image uploaded to Cloudinary amazon_images folder:', imageUrl);
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(500).json({ message: "Failed to upload image" });
      }
    }

    const isMobileFeatured = is_mobile_featured === true || is_mobile_featured === 'true';
    const showOnHome = show_on_home !== false && show_on_home !== 'false';
    const showOnArticle = show_on_article !== false && show_on_article !== 'false';

    // If setting this as mobile featured, unset all others
    if (isMobileFeatured) {
      await pool.query("UPDATE amazon_products SET is_mobile_featured = false");
    }

    const result = await pool.query(
      `INSERT INTO amazon_products (name, description, affiliate_link, image_url, is_active, display_order, is_mobile_featured, show_on_home, show_on_article)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, description, affiliate_link, imageUrl, is_active !== false && is_active !== 'false', parseInt(display_order) || 0, isMobileFeatured, showOnHome, showOnArticle]
    );

    res.status(201).json({
      message: "Amazon product created successfully",
      product: result.rows[0]
    });
  } catch (error) {
    console.error("Error creating Amazon product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/amazon-products/admin/:id
// @desc    Update an Amazon product
// @access  Private
router.put("/admin/:id", auth, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, affiliate_link, is_active, display_order, is_mobile_featured, show_on_home, show_on_article } = req.body;

    // Check if product exists
    const checkResult = await pool.query(
      "SELECT * FROM amazon_products WHERE id = $1",
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    let imageUrl = null;

    // Upload new image to Cloudinary if file is provided
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.buffer, 'amazon_images');
        imageUrl = uploadResult.secure_url;
        console.log('New image uploaded to Cloudinary amazon_images folder:', imageUrl);
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(500).json({ message: "Failed to upload image" });
      }
    }

    const isMobileFeatured = is_mobile_featured === true || is_mobile_featured === 'true';
    const showOnHome = show_on_home !== false && show_on_home !== 'false';
    const showOnArticle = show_on_article !== false && show_on_article !== 'false';

    // If setting this as mobile featured, unset all others
    if (isMobileFeatured) {
      await pool.query("UPDATE amazon_products SET is_mobile_featured = false WHERE id != $1", [id]);
    }

    const result = await pool.query(
      `UPDATE amazon_products
       SET name = $1, description = $2, affiliate_link = $3,
           image_url = COALESCE($4, image_url),
           is_active = $5, display_order = $6, is_mobile_featured = $7,
           show_on_home = $8, show_on_article = $9, updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [name, description, affiliate_link, imageUrl, is_active, parseInt(display_order), isMobileFeatured, showOnHome, showOnArticle, id]
    );

    res.json({
      message: "Amazon product updated successfully",
      product: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating Amazon product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/admin/amazon-products/:id
// @desc    Delete an Amazon product
// @access  Private
router.delete("/admin/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM amazon_products WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Amazon product deleted successfully" });
  } catch (error) {
    console.error("Error deleting Amazon product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
