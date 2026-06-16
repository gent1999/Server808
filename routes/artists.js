import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import { Readable } from 'stream';
import auth from '../middleware/auth.js';

const router = express.Router();

// Create table on boot (safe: IF NOT EXISTS)
pool.query(`
  CREATE TABLE IF NOT EXISTS artists (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    slug              VARCHAR(255) UNIQUE NOT NULL,
    bio               TEXT,
    profile_image_url TEXT,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(err => console.error('[Artists] Schema migration error:', err.message));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
}).single('profile_image');

const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'rap-blog/artists', resource_type: 'auto' },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    Readable.from(buffer).pipe(stream);
  });

function toSlug(name) {
  return name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

// GET /api/artists
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artists ORDER BY name ASC');
    res.json({ artists: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/artists/:slug — artist profile + their articles
router.get('/:slug', async (req, res) => {
  try {
    const { rows: [artist] } = await pool.query(
      'SELECT * FROM artists WHERE slug = $1',
      [req.params.slug]
    );
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const { rows: articles } = await pool.query(
      `SELECT id, title, author, image_url, categories, tags, created_at, article_url
       FROM articles
       WHERE LOWER(author) = LOWER($1)
       ORDER BY created_at DESC`,
      [artist.name]
    );

    res.json({ artist, articles });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/artists
router.post('/', auth, upload, [
  body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, bio } = req.body;
  const slug = toSlug(name);

  try {
    let profile_image_url = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      profile_image_url = result.secure_url;
    }

    const { rows: [artist] } = await pool.query(
      `INSERT INTO artists (name, slug, bio, profile_image_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, slug, bio || null, profile_image_url]
    );
    res.status(201).json({ artist });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'An artist with that name already exists' });
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/artists/:id
router.put('/:id', auth, upload, async (req, res) => {
  const { name, bio } = req.body;
  try {
    let profile_image_url;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      profile_image_url = result.secure_url;
    }

    const setClauses = [];
    const values = [];
    let i = 1;

    if (name)                { setClauses.push(`name=$${i++}`, `slug=$${i++}`); values.push(name, toSlug(name)); }
    if (bio !== undefined)   { setClauses.push(`bio=$${i++}`); values.push(bio || null); }
    if (profile_image_url)   { setClauses.push(`profile_image_url=$${i++}`); values.push(profile_image_url); }
    setClauses.push('updated_at=NOW()');
    values.push(req.params.id);

    const { rows: [artist] } = await pool.query(
      `UPDATE artists SET ${setClauses.join(', ')} WHERE id=$${i} RETURNING *`,
      values
    );
    if (!artist) return res.status(404).json({ message: 'Artist not found' });
    res.json({ artist });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'An artist with that name already exists' });
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/artists/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM artists WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Artist not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
