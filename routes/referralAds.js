import express from "express";
import pool from "../config/db.js";
import authMiddleware from "../middleware/auth.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

const router = express.Router();

// ── Multer + Cloudinary ───────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are allowed'), false),
});

const uploadToCloudinary = (buffer, folder = 'referral_ads') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    Readable.from(buffer).pipe(stream);
  });

// ── Auto-create table on boot ─────────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS referral_ads (
    id            SERIAL PRIMARY KEY,
    title         TEXT,
    image_url     TEXT NOT NULL,
    link_url      TEXT NOT NULL,
    is_active     BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);

// ── GET /api/referral-ads  — public, active only ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM referral_ads
       WHERE is_active = true
       ORDER BY display_order ASC, created_at DESC`
    );
    res.json({ ads: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/referral-ads/all  — admin, all ads ───────────────────────────────
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM referral_ads ORDER BY display_order ASC, created_at DESC`
    );
    res.json({ ads: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/referral-ads  — admin, create ───────────────────────────────────
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, link_url, display_order } = req.body;
    if (!link_url) return res.status(400).json({ message: 'link_url is required' });

    let image_url = req.body.image_url || null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      image_url = result.secure_url;
    }
    if (!image_url) return res.status(400).json({ message: 'An image is required' });

    const { rows } = await pool.query(
      `INSERT INTO referral_ads (title, image_url, link_url, display_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title || null, image_url, link_url, parseInt(display_order) || 0]
    );
    res.status(201).json({ ad: rows[0] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PUT /api/referral-ads/:id  — admin, update ────────────────────────────────
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM referral_ads WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Ad not found' });
    const ad = existing.rows[0];

    const { title, link_url, display_order, is_active } = req.body;

    let image_url = req.body.image_url || ad.image_url;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      image_url = result.secure_url;
    }

    const active =
      is_active !== undefined
        ? is_active === 'true' || is_active === true
        : ad.is_active;

    const { rows } = await pool.query(
      `UPDATE referral_ads
       SET title = $1, image_url = $2, link_url = $3, display_order = $4, is_active = $5
       WHERE id = $6 RETURNING *`,
      [
        title ?? ad.title,
        image_url,
        link_url || ad.link_url,
        display_order !== undefined ? parseInt(display_order) : ad.display_order,
        active,
        id,
      ]
    );
    res.json({ ad: rows[0] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── DELETE /api/referral-ads/:id  — admin ────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM referral_ads WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Ad not found' });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
