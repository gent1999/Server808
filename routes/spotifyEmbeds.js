import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import cloudinary from '../config/cloudinary.js';
import { Readable } from 'stream';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  }
});

const uploadToCloudinary = (buffer, folder = '2k-overalls/playlists') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => error ? reject(error) : resolve(result)
    );
    Readable.from(buffer).pipe(uploadStream);
  });
};

// GET all active Spotify embeds (public)
router.get('/', async (req, res) => {
  try {
    const { page_type, site } = req.query;

    let query = 'SELECT * FROM spotify_embeds WHERE is_active = true';
    const params = [];
    let paramCount = 0;

    if (page_type) {
      paramCount++;
      query += ` AND page_type = $${paramCount}`;
      params.push(page_type);
    }

    if (site) {
      paramCount++;
      query += ` AND site = $${paramCount}`;
      params.push(site);
    }

    query += ' ORDER BY display_order ASC, created_at DESC';

    const result = await pool.query(query, params);
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
    res.json({ embeds: result.rows });
  } catch (error) {
    console.error('Error fetching Spotify embeds:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET all Spotify embeds (admin - includes inactive)
router.get('/all', async (req, res) => {
  try {
    const { site } = req.query;

    let query = 'SELECT * FROM spotify_embeds';
    const params = [];

    if (site) {
      query += ' WHERE site = $1';
      params.push(site);
    }

    query += ' ORDER BY display_order ASC, created_at DESC';

    const result = await pool.query(query, params);
    res.json({ embeds: result.rows });
  } catch (error) {
    console.error('Error fetching all Spotify embeds:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET single Spotify embed by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM spotify_embeds WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Spotify embed not found' });
    }

    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
    res.json({ embed: result.rows[0] });
  } catch (error) {
    console.error('Error fetching Spotify embed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to parse Spotify URL
const parseSpotifyUrl = (url) => {
  try {
    // Extract type and ID from Spotify URL
    // Format: https://open.spotify.com/embed/playlist/37i9dQZF1DX0XUsuxWHRQd
    // or: https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd
    const match = url.match(/spotify\.com\/(embed\/)?(playlist|album|track|artist)\/([a-zA-Z0-9]+)/);

    if (!match) {
      return { type: 'playlist', id: null, embedUrl: url };
    }

    const type = match[2]; // playlist, album, track, or artist
    const id = match[3];

    // Convert to embed URL if it's not already
    let embedUrl = url;
    if (!url.includes('/embed/')) {
      embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    }

    return { type, id, embedUrl };
  } catch (error) {
    return { type: 'playlist', id: null, embedUrl: url };
  }
};

// POST create new Spotify embed / playlist (protected)
router.post('/', upload.single('cover_image'), async (req, res) => {
  try {
    const { spotify_url, page_type = 'home', site = 'cry808', title: titleInput, description, is_featured } = req.body;

    if (!spotify_url) {
      return res.status(400).json({ message: 'Spotify URL is required' });
    }

    // Parse the Spotify URL
    const { type, id, embedUrl } = parseSpotifyUrl(spotify_url);

    // Use a provided title (e.g. "ROTATION") or auto-generate one based on type
    const title = titleInput?.trim() || `Spotify ${type.charAt(0).toUpperCase() + type.slice(1)}`;

    let coverImageUrl = null;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      coverImageUrl = uploadResult.secure_url;
    }

    // Get the max display_order for this site and add 1
    const orderResult = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM spotify_embeds WHERE site = $1',
      [site]
    );
    const nextOrder = orderResult.rows[0].next_order;

    const result = await pool.query(
      `INSERT INTO spotify_embeds (title, spotify_url, embed_type, is_active, display_order, page_type, site, description, cover_image_url, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [title, embedUrl, type, true, nextOrder, page_type, site, description || null, coverImageUrl, is_featured === 'true' || is_featured === true]
    );

    res.status(201).json({
      message: 'Spotify embed created successfully',
      embed: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating Spotify embed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT update Spotify embed / playlist (protected)
router.put('/:id', upload.single('cover_image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, spotify_url, embed_type, is_active, display_order, description, is_featured } = req.body;

    const existing = await pool.query('SELECT * FROM spotify_embeds WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Spotify embed not found' });
    }

    let coverImageUrl = existing.rows[0].cover_image_url;
    if (req.file) {
      if (coverImageUrl) {
        const urlParts = coverImageUrl.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        const publicId = urlParts.slice(uploadIndex + 2).join('/').split('.')[0];
        try { await cloudinary.uploader.destroy(publicId); } catch (e) { console.error('Error deleting old cover image:', e); }
      }
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      coverImageUrl = uploadResult.secure_url;
    }

    const result = await pool.query(
      `UPDATE spotify_embeds
       SET title = $1, spotify_url = $2, embed_type = $3, is_active = $4, display_order = $5,
           description = $6, cover_image_url = $7, is_featured = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        title, spotify_url, embed_type, is_active === 'true' || is_active === true, display_order,
        description || null, coverImageUrl, is_featured === 'true' || is_featured === true, id
      ]
    );

    res.json({
      message: 'Spotify embed updated successfully',
      embed: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating Spotify embed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE Spotify embed (protected)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM spotify_embeds WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Spotify embed not found' });
    }

    res.json({ message: 'Spotify embed deleted successfully' });
  } catch (error) {
    console.error('Error deleting Spotify embed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
