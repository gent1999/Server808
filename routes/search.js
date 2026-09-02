import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// GET /api/search?q=&site=lowkeygrid - Unified search across overalls, articles, playlists
router.get('/', async (req, res) => {
  try {
    const { q, site = 'lowkeygrid' } = req.query;
    if (!q || !q.trim()) {
      return res.json({ overalls: [], articles: [], playlists: [] });
    }
    const like = `%${q.trim()}%`;

    const [overallsResult, articlesResult, playlistsResult] = await Promise.all([
      pool.query(
        `SELECT id, title, slug, image_url, overall FROM overalls
         WHERE title ILIKE $1 ORDER BY overall DESC NULLS LAST LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT id, title, category, image_url, thumbnail_url, created_at FROM articles
         WHERE title ILIKE $1 AND (site = $2 OR category IN ('article', 'interview'))
         ORDER BY created_at DESC LIMIT 5`,
        [like, site]
      ),
      pool.query(
        `SELECT id, title, description, cover_image_url, spotify_url FROM spotify_embeds
         WHERE title ILIKE $1 AND site = $2 AND page_type = 'playlist' AND is_active = true
         ORDER BY display_order ASC LIMIT 5`,
        [like, site]
      ),
    ]);

    res.json({
      overalls: overallsResult.rows,
      articles: articlesResult.rows,
      playlists: playlistsResult.rows,
    });
  } catch (error) {
    console.error('Error performing search:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
