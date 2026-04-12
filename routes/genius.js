import express from 'express';

const router = express.Router();

/**
 * Converts a Genius URL slug into a plain search query.
 * e.g. https://genius.com/2gs-like-gucci-lift-you-up-clean-lyrics
 *   -> "2gs like gucci lift you up clean"
 */
function slugToQuery(url) {
  try {
    const path = new URL(url).pathname;           // /2gs-like-gucci-lift-you-up-clean-lyrics
    return path
      .replace(/^\//, '')
      .replace(/-lyrics$/, '')
      .replace(/-/g, ' ')
      .trim();
  } catch {
    return null;
  }
}

// @route   GET /api/genius-lyrics
// @desc    Return lyrics for a Genius song URL via lrclib.net
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  const query = slugToQuery(url);
  if (!query) return res.status(400).json({ message: 'Invalid Genius URL' });

  try {
    const lrclibRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Cry808/1.0 (cry808.com)' } }
    );

    if (!lrclibRes.ok) {
      return res.status(502).json({ message: 'Lyrics service unavailable' });
    }

    const results = await lrclibRes.json();
    const hit = results.find(r => r.plainLyrics) || results[0];

    if (!hit || !hit.plainLyrics) {
      return res.status(404).json({ message: 'No lyrics found' });
    }

    res.json({
      lyrics: hit.plainLyrics,
      title:  `${hit.artistName} – ${hit.trackName}`,
    });
  } catch (error) {
    console.error('Lyrics fetch error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
