import express from 'express';
import Genius from 'genius-lyrics';

const router = express.Router();

// @route   GET /api/genius-lyrics?url=
// @desc    Fetch lyrics for a Genius song URL
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ message: 'GENIUS_ACCESS_TOKEN not configured' });

  try {
    const client = new Genius.Client(token);

    // Extract the slug from the URL to use as search query
    const slug = new URL(url).pathname
      .replace(/^\//, '')
      .replace(/-lyrics$/, '')
      .replace(/-/g, ' ')
      .trim();

    const results = await client.songs.search(slug);
    if (!results.length) {
      return res.status(404).json({ message: 'Song not found on Genius' });
    }

    // Find the result whose URL matches, or fall back to first result
    const song = results.find(s => s.url?.toLowerCase() === url.toLowerCase()) || results[0];

    const lyrics = await song.lyrics();
    if (!lyrics) {
      return res.status(404).json({ message: 'Lyrics not available for this song' });
    }

    res.json({
      lyrics,
      title: `${song.artist?.name || ''} – ${song.title || ''}`.trim(),
    });
  } catch (error) {
    console.error('[genius-lyrics] error:', error.message);
    res.status(500).json({ message: 'Failed to fetch lyrics' });
  }
});

export default router;
