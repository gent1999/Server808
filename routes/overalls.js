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

const VALID_ARTIST_TIERS = ['mainstream', 'rising', 'underground', 'legend'];

// Parses the 'attributes' form field (JSON string like {"Lyrics":94,...}) safely
const parseAttributes = (raw) => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

// Replaces this overall's linked articles with the given comma-separated id list
const syncOverallArticles = async (overallId, articleIdsRaw) => {
  if (articleIdsRaw === undefined) return; // field not sent — leave links untouched
  const ids = (articleIdsRaw || '')
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => Number.isInteger(n));

  await pool.query('DELETE FROM overall_articles WHERE overall_id = $1', [overallId]);
  if (ids.length === 0) return;

  const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO overall_articles (overall_id, article_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [overallId, ...ids]
  );
};

// Same as syncOverallArticles, but for links to the native koveralls_articles
// table (Related Coverage now points here going forward).
const syncOverallKoverallsArticles = async (overallId, koverallsArticleIdsRaw) => {
  if (koverallsArticleIdsRaw === undefined) return; // field not sent — leave links untouched
  const ids = (koverallsArticleIdsRaw || '')
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => Number.isInteger(n));

  await pool.query('DELETE FROM overall_koveralls_articles WHERE overall_id = $1', [overallId]);
  if (ids.length === 0) return;

  const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO overall_koveralls_articles (overall_id, koveralls_article_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [overallId, ...ids]
  );
};

// Shared CTE that computes each overall's latest rating change from history.
// Only overalls with 2+ history rows produce a non-null change; others get NULL
// via the LEFT JOINs below rather than being excluded.
const CHANGE_CTE = `
  WITH history_ranked AS (
    SELECT overall_id, rating, recorded_at,
           ROW_NUMBER() OVER (PARTITION BY overall_id ORDER BY recorded_at DESC) AS rn
    FROM overall_rating_history
  ),
  latest AS (SELECT overall_id, rating FROM history_ranked WHERE rn = 1),
  previous AS (SELECT overall_id, rating FROM history_ranked WHERE rn = 2)
`;

const VALID_TIERS = ['mainstream', 'rising', 'underground', 'legend'];

// GET /api/overalls - Get all overalls (public), with optional search/filter/sort
router.get("/", async (req, res) => {
  try {
    const { q, tier, sort } = req.query;

    const needsChange = sort === 'rising' || sort === 'falling';
    const where = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`o.title ILIKE $${params.length}`);
    }
    if (tier && VALID_TIERS.includes(tier)) {
      params.push(tier);
      where.push(`o.artist_tier = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let orderClause = 'ORDER BY o.created_at DESC';
    if (sort === 'highest') orderClause = 'ORDER BY o.overall DESC NULLS LAST';
    else if (sort === 'lowest') orderClause = 'ORDER BY o.overall ASC NULLS LAST';
    else if (sort === 'newest') orderClause = 'ORDER BY o.created_at DESC';
    else if (sort === 'updated') orderClause = 'ORDER BY o.updated_at DESC';
    else if (sort === 'alpha') orderClause = 'ORDER BY o.title ASC';
    else if (sort === 'rising') orderClause = 'ORDER BY change DESC';
    else if (sort === 'falling') orderClause = 'ORDER BY change ASC';

    let query;
    if (needsChange) {
      query = `
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        JOIN latest ON latest.overall_id = o.id
        JOIN previous ON previous.overall_id = o.id
        ${whereClause}
        ${orderClause}
      `;
    } else {
      query = `
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        LEFT JOIN latest ON latest.overall_id = o.id
        LEFT JOIN previous ON previous.overall_id = o.id
        ${whereClause}
        ${orderClause}
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching overalls:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/stock-watch - Top risers/fallers from rating history (public)
router.get("/stock-watch", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const upResult = await pool.query(`
      ${CHANGE_CTE}
      SELECT o.id, o.title, o.slug, o.image_url, o.overall, o.crop_x, o.crop_y,
             (latest.rating - previous.rating) AS change
      FROM overalls o
      JOIN latest ON latest.overall_id = o.id
      JOIN previous ON previous.overall_id = o.id
      WHERE (latest.rating - previous.rating) > 0
      ORDER BY change DESC
      LIMIT $1
    `, [limit]);

    const downResult = await pool.query(`
      ${CHANGE_CTE}
      SELECT o.id, o.title, o.slug, o.image_url, o.overall, o.crop_x, o.crop_y,
             (latest.rating - previous.rating) AS change
      FROM overalls o
      JOIN latest ON latest.overall_id = o.id
      JOIN previous ON previous.overall_id = o.id
      WHERE (latest.rating - previous.rating) < 0
      ORDER BY change ASC
      LIMIT $1
    `, [limit]);

    res.json({ up: upResult.rows, down: downResult.rows });
  } catch (error) {
    console.error("Error fetching stock watch:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/rankings?view= - Leaderboard views (public)
router.get("/rankings", async (req, res) => {
  try {
    const view = req.query.view || 'top';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    let rows;

    if (view === 'rising' || view === 'falling') {
      const cmp = view === 'rising' ? '> 0' : '< 0';
      const order = view === 'rising' ? 'DESC' : 'ASC';
      const result = await pool.query(`
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        JOIN latest ON latest.overall_id = o.id
        JOIN previous ON previous.overall_id = o.id
        WHERE (latest.rating - previous.rating) ${cmp}
        ORDER BY change ${order}
        LIMIT $1
      `, [limit]);
      rows = result.rows;
    } else if (view === 'new') {
      const result = await pool.query(`
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        LEFT JOIN latest ON latest.overall_id = o.id
        LEFT JOIN previous ON previous.overall_id = o.id
        ORDER BY o.created_at DESC
        LIMIT $1
      `, [limit]);
      rows = result.rows;
    } else if (view === 'underground' || view === 'legends') {
      const tier = view === 'legends' ? 'legend' : 'underground';
      const result = await pool.query(`
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        LEFT JOIN latest ON latest.overall_id = o.id
        LEFT JOIN previous ON previous.overall_id = o.id
        WHERE o.artist_tier = $1
        ORDER BY o.overall DESC NULLS LAST
        LIMIT $2
      `, [tier, limit]);
      rows = result.rows;
    } else {
      // 'top' - all overalls by highest rating
      const result = await pool.query(`
        ${CHANGE_CTE}
        SELECT o.*, (latest.rating - previous.rating) AS change
        FROM overalls o
        LEFT JOIN latest ON latest.overall_id = o.id
        LEFT JOIN previous ON previous.overall_id = o.id
        ORDER BY o.overall DESC NULLS LAST
        LIMIT $1
      `, [limit]);
      rows = result.rows;
    }

    res.json(rows.map((row, i) => ({ ...row, rank: i + 1 })));
  } catch (error) {
    console.error("Error fetching rankings:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/featured/hero - Get hero featured overall (public)
router.get("/featured/hero", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM overalls WHERE is_hero_featured = true LIMIT 1"
    );
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching hero featured overall:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/featured/squares - Get square featured overalls (public)
router.get("/featured/squares", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM overalls WHERE is_square_featured = true ORDER BY updated_at DESC LIMIT 3"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching square featured overalls:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/overalls/:id/hero-feature - Set as hero featured (protected)
router.put("/:id/hero-feature", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if overall exists
    const check = await pool.query("SELECT id FROM overalls WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    // Unset all other hero featured
    await pool.query("UPDATE overalls SET is_hero_featured = false WHERE is_hero_featured = true");

    // Set this one as hero featured
    const result = await pool.query(
      "UPDATE overalls SET is_hero_featured = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error setting hero featured:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/overalls/:id/hero-feature - Remove hero featured (protected)
router.delete("/:id/hero-feature", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE overalls SET is_hero_featured = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error removing hero featured:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/overalls/:id/square-feature - Set as square featured (protected)
router.put("/:id/square-feature", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if overall exists
    const check = await pool.query("SELECT id, is_square_featured FROM overalls WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    // If already square featured, just return it
    if (check.rows[0].is_square_featured) {
      return res.json(check.rows[0]);
    }

    // Check how many are already square featured
    const countResult = await pool.query("SELECT COUNT(*) FROM overalls WHERE is_square_featured = true");
    if (parseInt(countResult.rows[0].count) >= 3) {
      return res.status(400).json({ error: "Maximum 3 square featured overalls allowed. Remove one first." });
    }

    const result = await pool.query(
      "UPDATE overalls SET is_square_featured = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error setting square featured:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/overalls/:id/square-feature - Remove square featured (protected)
router.delete("/:id/square-feature", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE overalls SET is_square_featured = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error removing square featured:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/overalls/:id/crop - Update square crop settings (protected)
router.put("/:id/crop", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { crop_x, crop_y, crop_zoom } = req.body;

    const result = await pool.query(
      `UPDATE overalls SET crop_x = $1, crop_y = $2, crop_zoom = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [crop_x ?? 50, crop_y ?? 50, crop_zoom ?? 100, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating crop settings:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/overalls/:id/hero-crop - Update hero-specific crop settings (protected)
router.put("/:id/hero-crop", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { hero_crop_x, hero_crop_y, hero_crop_zoom } = req.body;

    const result = await pool.query(
      `UPDATE overalls SET hero_crop_x = $1, hero_crop_y = $2, hero_crop_zoom = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [hero_crop_x ?? 50, hero_crop_y ?? 50, hero_crop_zoom ?? 100, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating hero crop settings:", error);
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

// GET /api/overalls/slug/:slug/history - Rating history + current/previous/peak (public)
router.get("/slug/:slug/history", async (req, res) => {
  try {
    const { slug } = req.params;
    const overallResult = await pool.query("SELECT id FROM overalls WHERE slug = $1", [slug]);
    if (overallResult.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }
    const overallId = overallResult.rows[0].id;

    const historyResult = await pool.query(
      "SELECT rating, recorded_at FROM overall_rating_history WHERE overall_id = $1 ORDER BY recorded_at ASC",
      [overallId]
    );

    const timeline = historyResult.rows;
    const current = timeline.length ? timeline[timeline.length - 1].rating : null;
    const previous = timeline.length > 1 ? timeline[timeline.length - 2].rating : null;
    const peak = timeline.length ? Math.max(...timeline.map(r => r.rating)) : null;
    const change = current !== null && previous !== null ? current - previous : null;

    res.json({ timeline, current, previous, peak, change });
  } catch (error) {
    console.error("Error fetching overall history:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/overalls/slug/:slug/related - Related articles + related artists (public)
router.get("/slug/:slug/related", async (req, res) => {
  try {
    const { slug } = req.params;
    const overallResult = await pool.query(
      "SELECT id, artist_tier FROM overalls WHERE slug = $1",
      [slug]
    );
    if (overallResult.rows.length === 0) {
      return res.status(404).json({ error: "Overall not found" });
    }
    const { id: overallId, artist_tier } = overallResult.rows[0];

    const [articlesResult, koverallsArticlesResult] = await Promise.all([
      pool.query(
        `SELECT a.* FROM articles a
         JOIN overall_articles oa ON oa.article_id = a.id
         WHERE oa.overall_id = $1
         ORDER BY a.created_at DESC`,
        [overallId]
      ),
      pool.query(
        `SELECT ka.* FROM koveralls_articles ka
         JOIN overall_koveralls_articles oka ON oka.koveralls_article_id = ka.id
         WHERE oka.overall_id = $1
         ORDER BY ka.created_at DESC`,
        [overallId]
      ),
    ]);
    const relatedArticles = [...articlesResult.rows, ...koverallsArticlesResult.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    let relatedArtists = [];
    if (artist_tier) {
      const artistsResult = await pool.query(
        `SELECT id, title, slug, image_url, overall, crop_x, crop_y
         FROM overalls WHERE artist_tier = $1 AND id != $2
         ORDER BY overall DESC NULLS LAST LIMIT 6`,
        [artist_tier, overallId]
      );
      relatedArtists = artistsResult.rows;
    }

    res.json({ articles: relatedArticles, artists: relatedArtists });
  } catch (error) {
    console.error("Error fetching related content:", error);
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
      const { title, content, overall, instagram_link, artist_tier, location, attributes, article_ids, koveralls_article_ids } = req.body;

      const tier = VALID_ARTIST_TIERS.includes(artist_tier) ? artist_tier : null;
      const parsedAttributes = parseAttributes(attributes);

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
        `INSERT INTO overalls (title, image_url, content, slug, overall, instagram_link, artist_tier, location, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          title, imageUrl, content, finalSlug, overall || null, instagram_link || null,
          tier, location || null, parsedAttributes ? JSON.stringify(parsedAttributes) : null
        ]
      );

      const created = result.rows[0];

      // Seed initial rating history so this overall has a starting point on its chart
      if (created.overall !== null) {
        await pool.query(
          'INSERT INTO overall_rating_history (overall_id, rating) VALUES ($1, $2)',
          [created.id, created.overall]
        );
      }

      await syncOverallArticles(created.id, article_ids);
      await syncOverallKoverallsArticles(created.id, koveralls_article_ids);

      res.status(201).json(created);
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
      const { title, content, overall, instagram_link, artist_tier, location, attributes, article_ids, koveralls_article_ids } = req.body;

      // Check if overall exists
      const existingOverall = await pool.query(
        "SELECT * FROM overalls WHERE id = $1",
        [id]
      );

      if (existingOverall.rows.length === 0) {
        return res.status(404).json({ error: "Overall not found" });
      }
      const existing = existingOverall.rows[0];

      // artist_tier: '' clears it, a valid tier sets it, anything else (field omitted) keeps existing
      const tier = artist_tier === ''
        ? null
        : (VALID_ARTIST_TIERS.includes(artist_tier) ? artist_tier : existing.artist_tier);
      const newLocation = location === undefined ? existing.location : (location || null);
      const parsedAttributes = attributes === undefined ? existing.attributes : parseAttributes(attributes);

      let imageUrl = existing.image_url;

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

      const newRating = overall === undefined ? existing.overall : (overall === '' ? null : parseInt(overall));

      // Update overall
      const result = await pool.query(
        `UPDATE overalls
         SET title = $1, image_url = $2, content = $3, slug = $4, overall = $5, instagram_link = $6,
             artist_tier = $7, location = $8, attributes = $9, updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING *`,
        [
          title, imageUrl, content, slug, newRating, instagram_link || null,
          tier, newLocation, parsedAttributes ? JSON.stringify(parsedAttributes) : null, id
        ]
      );

      const updated = result.rows[0];

      // Record rating history whenever the rating actually changes
      if (newRating !== null && newRating !== existing.overall) {
        await pool.query(
          'INSERT INTO overall_rating_history (overall_id, rating) VALUES ($1, $2)',
          [id, newRating]
        );
      }

      await syncOverallArticles(id, article_ids);
      await syncOverallKoverallsArticles(id, koveralls_article_ids);

      res.json(updated);
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
