import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import { Readable } from 'stream';
import auth from '../middleware/auth.js';

const router = express.Router();

// Create tables on boot (safe: IF NOT EXISTS)
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
`).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS artist_articles (
    artist_id  INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    linked_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (artist_id, article_id)
  )
`)).catch(err => console.error('[Artists] Schema migration error:', err.message));

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

// GET /api/artists/:slug — artist profile + manually linked articles
router.get('/:slug', async (req, res) => {
  try {
    const { rows: [artist] } = await pool.query(
      'SELECT * FROM artists WHERE slug = $1',
      [req.params.slug]
    );
    if (!artist) return res.status(404).json({ message: 'Artist not found' });

    const { rows: articles } = await pool.query(
      `SELECT a.id, a.title, a.author, a.image_url, a.categories, a.tags, a.created_at, a.article_url
       FROM articles a
       JOIN artist_articles aa ON aa.article_id = a.id
       WHERE aa.artist_id = $1
       ORDER BY aa.linked_at DESC`,
      [artist.id]
    );

    res.json({ artist, articles });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/artists/:id/link/:articleId — manually link an article
router.post('/:id/link/:articleId', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO artist_articles (artist_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.params.articleId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/artists/:id/link/:articleId — unlink an article
router.delete('/:id/link/:articleId', auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM artist_articles WHERE artist_id=$1 AND article_id=$2`,
      [req.params.id, req.params.articleId]
    );
    res.json({ ok: true });
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
