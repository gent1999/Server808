import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// GET all active Spotify embeds (public)
router.get('/', async (req, res) => {
  try {
    const { page_type } = req.query;

    let query = 'SELECT * FROM spotify_embeds WHERE is_active = true';
    const params = [];

    if (page_type) {
      query += ' AND page_type = $1';
      params.push(page_type);
    }

    query += ' ORDER BY display_order ASC, created_at DESC';

    const result = await pool.query(query, params);
    res.json({ embeds: result.rows });
  } catch (error) {
    console.error('Error fetching Spotify embeds:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET all Spotify embeds (admin - includes inactive)
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM spotify_embeds ORDER BY display_order ASC, created_at DESC'
    );
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

// POST create new Spotify embed (protected)
router.post('/', async (req, res) => {
  try {
    const { spotify_url, page_type = 'home' } = req.body;

    if (!spotify_url) {
      return res.status(400).json({ message: 'Spotify URL is required' });
    }

    // Parse the Spotify URL
    const { type, id, embedUrl } = parseSpotifyUrl(spotify_url);

    // Auto-generate title based on type
    const title = `Spotify ${type.charAt(0).toUpperCase() + type.slice(1)}`;

    // Get the max display_order and add 1
    const orderResult = await pool.query('SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM spotify_embeds');
    const nextOrder = orderResult.rows[0].next_order;

    const result = await pool.query(
      `INSERT INTO spotify_embeds (title, spotify_url, embed_type, is_active, display_order, page_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, embedUrl, type, true, nextOrder, page_type]
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

// PUT update Spotify embed (protected)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, spotify_url, embed_type, is_active, display_order } = req.body;

    const result = await pool.query(
      `UPDATE spotify_embeds
       SET title = $1, spotify_url = $2, embed_type = $3, is_active = $4, display_order = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [title, spotify_url, embed_type, is_active, display_order, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Spotify embed not found' });
    }

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
