import express from "express";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import auth from "../middleware/auth.js";
import { pingSitemap, requestIndexing } from "../utils/sitemapPing.js";
import fetch from "node-fetch";

const router = express.Router();

// ── Article indexing schema migration (runs on every boot, safe with IF NOT EXISTS) ──
pool.query(`
  ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS article_url               TEXT,
    ADD COLUMN IF NOT EXISTS indexed_on_google         BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_index_checked_at     TIMESTAMP,
    ADD COLUMN IF NOT EXISTS index_attempt_count       INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS first_index_requested_at  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_index_requested_at   TIMESTAMP,
    ADD COLUMN IF NOT EXISTS indexed_detected_at       TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_index_status         VARCHAR(30),
    ADD COLUMN IF NOT EXISTS last_index_error          TEXT
`).then(() =>
  // Backfill article_url for any existing articles that don't have it yet.
  // Replicates the same slug logic used in the POST /api/articles handler.
  pool.query(`
    UPDATE articles
    SET article_url = CONCAT(
      'https://cry808.com/article/',
      id::text, '-',
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(LOWER(TRIM(title)), '\\s+', '-', 'g'),
          '[^a-z0-9\\-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    )
    WHERE article_url IS NULL AND title IS NOT NULL
  `)
).catch(err => console.error('[Articles] Index schema migration error:', err.message));

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

// Configure upload for multiple images (cover + 3 additional)
const uploadMultiple = upload.fields([
  { name: 'image', maxCount: 1 },           // Cover image
  { name: 'additional_image_1', maxCount: 1 },
  { name: 'additional_image_2', maxCount: 1 },
  { name: 'additional_image_3', maxCount: 1 }
]);

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (buffer, folder = 'rap-blog') => {
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

// @route   POST /api/articles
// @desc    Create a new article
// @access  Private (requires admin authentication)
router.post(
  "/",
  auth, // Add authentication middleware
  uploadMultiple, // Handle multiple image uploads
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

    const { title, author, content, tags, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, category, image_url, is_original, is_evergreen } = req.body;

    try {
      let imageUrl = image_url || null; // Use provided URL if exists
      let additionalImage1 = null;
      let additionalImage2 = null;
      let additionalImage3 = null;

      // Upload cover image to Cloudinary if file is provided (overrides URL)
      if (req.files && req.files['image'] && req.files['image'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
          imageUrl = uploadResult.secure_url;
          console.log('Cover image uploaded to Cloudinary:', imageUrl);
        } catch (uploadError) {
          console.error('Cloudinary upload error:', uploadError);
          return res.status(500).json({ message: "Failed to upload cover image" });
        }
      } else if (image_url) {
        console.log('Using provided image URL:', image_url);
      }

      // Upload additional images to Cloudinary
      if (req.files && req.files['additional_image_1'] && req.files['additional_image_1'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_1'][0].buffer);
          additionalImage1 = uploadResult.secure_url;
          console.log('Additional image 1 uploaded:', additionalImage1);
        } catch (uploadError) {
          console.error('Additional image 1 upload error:', uploadError);
        }
      }

      if (req.files && req.files['additional_image_2'] && req.files['additional_image_2'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_2'][0].buffer);
          additionalImage2 = uploadResult.secure_url;
          console.log('Additional image 2 uploaded:', additionalImage2);
        } catch (uploadError) {
          console.error('Additional image 2 upload error:', uploadError);
        }
      }

      if (req.files && req.files['additional_image_3'] && req.files['additional_image_3'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_3'][0].buffer);
          additionalImage3 = uploadResult.secure_url;
          console.log('Additional image 3 uploaded:', additionalImage3);
        } catch (uploadError) {
          console.error('Additional image 3 upload error:', uploadError);
        }
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

      // Insert article into database with all images
      const result = await pool.query(
        `INSERT INTO articles (title, author, content, tags, image_url, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, category, is_original, is_evergreen, additional_image_1, additional_image_2, additional_image_3)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [title, author, content, tagsArray, imageUrl, spotify_url || null, youtube_url || null, soundcloud_url || null, genius_url || null, lyrics || null, category || 'article', is_original === 'true' || is_original === true || false, is_evergreen === 'true' || is_evergreen === true || false, additionalImage1, additionalImage2, additionalImage3]
      );

      const newArticle = result.rows[0];

      // Build canonical article URL + record initial indexing state
      const articleSlugForUrl = newArticle.title
        .toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
      const canonicalUrl = `https://cry808.com/article/${newArticle.id}-${articleSlugForUrl}`;

      pool.query(
        `UPDATE articles
         SET article_url              = $1,
             last_index_status        = 'requested',
             first_index_requested_at = CURRENT_TIMESTAMP,
             last_index_requested_at  = CURRENT_TIMESTAMP,
             index_attempt_count      = 1
         WHERE id = $2`,
        [canonicalUrl, newArticle.id]
      ).catch(err => console.error('[Articles] Index state update error:', err.message));

      // Notify search engines about the new article
      pingSitemap().catch(err => console.error('Sitemap ping error:', err));

      // Request immediate indexing via IndexNow
      const articleSlug = newArticle.title
        .toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
      const articleUrl = `https://cry808.com/article/${newArticle.id}-${articleSlug}`;
      requestIndexing(articleUrl, process.env.INDEXNOW_KEY)
        .catch(err => console.error('IndexNow error:', err));

      // Wake the 808engine Indexer — pass metadata so it can label the job correctly
      const engineUrl = process.env.ENGINE_URL;
      if (engineUrl) {
        fetch(`${engineUrl}/api/indexer/wake`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.ENGINE_SECRET ? { 'x-engine-secret': process.env.ENGINE_SECRET } : {}),
          },
          body: JSON.stringify({
            url:       articleUrl,
            title:     title,
            source:    'manual',
            articleId: newArticle.id,
          }),
        })
          .then(() => console.log('[Indexer] Woke 808engine for:', articleUrl))
          .catch(err => console.error('[Indexer] Failed to wake agent:', err.message));
      } else {
        console.log('[Indexer] ENGINE_URL not set — add it to env to auto-trigger indexing');
      }

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
      "SELECT id, title, author, content, image_url, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, tags, category, is_featured, is_original, is_evergreen, additional_image_1, additional_image_2, additional_image_3, created_at, updated_at FROM articles WHERE site = 'cry808' AND category IN ('article', 'interview') ORDER BY created_at DESC"
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

// @route   GET /api/articles/featured
// @desc    Get featured article
// @access  Public
router.get("/featured/article", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, author, content, image_url, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, tags, category, is_featured, is_original, is_evergreen, additional_image_1, additional_image_2, additional_image_3, created_at, updated_at FROM articles WHERE is_featured = true AND site = 'cry808' AND category IN ('article', 'interview') LIMIT 1"
    );

    // If no featured article, return the latest one
    if (result.rows.length === 0) {
      const latestResult = await pool.query(
        "SELECT id, title, author, content, image_url, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, tags, category, is_featured, is_original, is_evergreen, additional_image_1, additional_image_2, additional_image_3, created_at, updated_at FROM articles WHERE site = 'cry808' AND category IN ('article', 'interview') ORDER BY created_at DESC LIMIT 1"
      );

      return res.json({
        article: latestResult.rows[0] || null,
        isFallback: true
      });
    }

    res.json({
      article: result.rows[0],
      isFallback: false
    });
  } catch (error) {
    console.error('Error fetching featured article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/articles/index-check-queue ──────────────────────────────────────
router.get('/index-check-queue', auth, async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  try {
    const { rows } = await pool.query(
      `SELECT id, title, article_url,
              indexed_on_google, last_index_checked_at,
              index_attempt_count, last_index_status,
              first_index_requested_at, last_index_requested_at,
              created_at
       FROM articles
       WHERE article_url IS NOT NULL
         AND (indexed_on_google = false OR indexed_on_google IS NULL)
         AND (
           last_index_checked_at IS NULL
           OR last_index_checked_at < NOW() - INTERVAL '6 hours'
         )
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ articles: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/articles/index-stats ─────────────────────────────────────────────
router.get('/index-stats', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE indexed_on_google = true)                             AS indexed,
        COUNT(*) FILTER (WHERE indexed_on_google = false OR indexed_on_google IS NULL) AS not_indexed,
        COUNT(*) FILTER (WHERE last_index_status = 'requested')                      AS requested,
        COUNT(*) FILTER (WHERE last_index_status = 'not_indexed')                    AS confirmed_not_indexed,
        COUNT(*) FILTER (WHERE last_index_status = 'error')                          AS errored,
        COUNT(*)                                                                      AS total
      FROM articles
      WHERE article_url IS NOT NULL
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   GET /api/articles/:id
// @desc    Get single article by ID
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT id, title, author, content, image_url, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, tags, category, is_featured, is_original, is_evergreen, additional_image_1, additional_image_2, additional_image_3, created_at, updated_at FROM articles WHERE id = $1 AND site = 'cry808' AND category IN ('article', 'interview')",
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
  auth, // Add authentication middleware
  uploadMultiple, // Handle multiple image uploads
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
    const { title, author, content, tags, spotify_url, youtube_url, soundcloud_url, genius_url, lyrics, category, is_original, is_evergreen, remove_additional_image_1, remove_additional_image_2, remove_additional_image_3 } = req.body;

    try {
      // Check if article exists
      const checkResult = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ message: "Article not found" });
      }

      let imageUrl = null;
      let additionalImage1 = null;
      let additionalImage2 = null;
      let additionalImage3 = null;

      // Upload new cover image to Cloudinary if file is provided
      if (req.files && req.files['image'] && req.files['image'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['image'][0].buffer);
          imageUrl = uploadResult.secure_url;
          console.log('New cover image uploaded to Cloudinary:', imageUrl);
        } catch (uploadError) {
          console.error('Cloudinary upload error:', uploadError);
          return res.status(500).json({ message: "Failed to upload cover image" });
        }
      }

      // Upload new additional images if provided
      if (req.files && req.files['additional_image_1'] && req.files['additional_image_1'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_1'][0].buffer);
          additionalImage1 = uploadResult.secure_url;
          console.log('New additional image 1 uploaded:', additionalImage1);
        } catch (uploadError) {
          console.error('Additional image 1 upload error:', uploadError);
        }
      }

      if (req.files && req.files['additional_image_2'] && req.files['additional_image_2'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_2'][0].buffer);
          additionalImage2 = uploadResult.secure_url;
          console.log('New additional image 2 uploaded:', additionalImage2);
        } catch (uploadError) {
          console.error('Additional image 2 upload error:', uploadError);
        }
      }

      if (req.files && req.files['additional_image_3'] && req.files['additional_image_3'][0]) {
        try {
          const uploadResult = await uploadToCloudinary(req.files['additional_image_3'][0].buffer);
          additionalImage3 = uploadResult.secure_url;
          console.log('New additional image 3 uploaded:', additionalImage3);
        } catch (uploadError) {
          console.error('Additional image 3 upload error:', uploadError);
        }
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

      // Parse is_original - DEBUG
      console.log('Received is_original:', is_original, 'Type:', typeof is_original);

      // Convert is_original to boolean (handles 'true', 'false', true, false)
      let isOriginalValue = false; // Default to false
      if (is_original === 'true' || is_original === true) {
        isOriginalValue = true;
      }
      console.log('Parsed isOriginalValue:', isOriginalValue);

      // Convert is_evergreen to boolean
      let isEvergreenValue = false; // Default to false
      if (is_evergreen === 'true' || is_evergreen === true) {
        isEvergreenValue = true;
      }

      // Resolve final additional image values (support explicit removal)
      const existingArticle = checkResult.rows[0];
      let finalAdditionalImage1 = existingArticle.additional_image_1;
      if (remove_additional_image_1 === 'true') finalAdditionalImage1 = null;
      else if (additionalImage1) finalAdditionalImage1 = additionalImage1;

      let finalAdditionalImage2 = existingArticle.additional_image_2;
      if (remove_additional_image_2 === 'true') finalAdditionalImage2 = null;
      else if (additionalImage2) finalAdditionalImage2 = additionalImage2;

      let finalAdditionalImage3 = existingArticle.additional_image_3;
      if (remove_additional_image_3 === 'true') finalAdditionalImage3 = null;
      else if (additionalImage3) finalAdditionalImage3 = additionalImage3;

      // Update article (only update images if new ones were uploaded)
      const result = await pool.query(
        `UPDATE articles
         SET title = COALESCE($1, title),
             author = COALESCE($2, author),
             content = COALESCE($3, content),
             tags = COALESCE($4, tags),
             image_url = COALESCE($5, image_url),
             spotify_url = COALESCE($6, spotify_url),
             youtube_url = COALESCE($7, youtube_url),
             soundcloud_url = COALESCE($8, soundcloud_url),
             genius_url = COALESCE($9, genius_url),
             lyrics = COALESCE($10, lyrics),
             category = COALESCE($11, category),
             is_original = $12,
             is_evergreen = $13,
             additional_image_1 = $14,
             additional_image_2 = $15,
             additional_image_3 = $16,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $17
         RETURNING *`,
        [title || null, author || null, content || null, tagsArray.length > 0 ? tagsArray : null, imageUrl, spotify_url || null, youtube_url || null, soundcloud_url || null, genius_url || null, lyrics || null, category || null, isOriginalValue, isEvergreenValue, finalAdditionalImage1, finalAdditionalImage2, finalAdditionalImage3, id]
      );

      console.log('Updated is_original to:', result.rows[0].is_original);

      // Notify search engines about the updated article
      pingSitemap().catch(err => console.error('Sitemap ping error:', err));

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
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // First, get the article to retrieve the image URL
    const getResult = await pool.query(
      'SELECT * FROM articles WHERE id = $1',
      [id]
    );

    if (getResult.rows.length === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    const article = getResult.rows[0];

    // Helper function to delete Cloudinary image
    const deleteCloudinaryImage = async (imageUrl, label) => {
      if (imageUrl && imageUrl.includes('cloudinary.com')) {
        try {
          // Extract public_id from Cloudinary URL
          // URL format: https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{public_id}.{format}
          const urlParts = imageUrl.split('/');
          const uploadIndex = urlParts.indexOf('upload');

          if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
            // Get everything after 'upload/v{version}/' and remove file extension
            const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
            const publicId = publicIdWithFolder.split('.')[0]; // Remove .jpg, .png, etc.

            console.log(`Deleting ${label} from Cloudinary:`, publicId);
            await cloudinary.uploader.destroy(publicId);
            console.log(`${label} deleted successfully from Cloudinary`);
          }
        } catch (cloudinaryError) {
          console.error(`Error deleting ${label} from Cloudinary:`, cloudinaryError);
          // Continue with article deletion even if Cloudinary deletion fails
        }
      }
    };

    // Delete all images from Cloudinary
    await deleteCloudinaryImage(article.image_url, 'Cover image');
    await deleteCloudinaryImage(article.additional_image_1, 'Additional image 1');
    await deleteCloudinaryImage(article.additional_image_2, 'Additional image 2');
    await deleteCloudinaryImage(article.additional_image_3, 'Additional image 3');

    // Delete article from database
    const result = await pool.query(
      'DELETE FROM articles WHERE id = $1 RETURNING *',
      [id]
    );

    // Notify search engines about the deleted article
    pingSitemap().catch(err => console.error('Sitemap ping error:', err));

    res.json({
      message: "Article deleted successfully",
      article: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting article:', error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ── PATCH /api/articles/:id/index-status ──────────────────────────────────────
router.patch('/:id/index-status', auth, async (req, res) => {
  const { id } = req.params;
  const {
    indexed_on_google,
    last_index_status,
    last_index_error,
    indexed_detected_at,
    last_index_checked_at,
    last_index_requested_at,
    index_attempt_count,
  } = req.body;

  try {
    await pool.query(
      `UPDATE articles
       SET indexed_on_google        = COALESCE($1, indexed_on_google),
           last_index_status        = COALESCE($2, last_index_status),
           last_index_error         = $3,
           indexed_detected_at      = COALESCE($4, indexed_detected_at),
           last_index_checked_at    = COALESCE($5, CURRENT_TIMESTAMP),
           last_index_requested_at  = COALESCE($6, last_index_requested_at),
           index_attempt_count      = COALESCE($7, index_attempt_count),
           updated_at               = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [
        indexed_on_google ?? null,
        last_index_status || null,
        last_index_error || null,
        indexed_detected_at || null,
        last_index_checked_at || null,
        last_index_requested_at || null,
        index_attempt_count ?? null,
        id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
