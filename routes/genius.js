import express from 'express';

const router = express.Router();

// @route   GET /api/genius-embed
// @desc    Proxy Genius oEmbed to avoid CORS — returns song ID needed for embed.js
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ message: 'url query parameter is required' });
  }

  try {
    const oembedUrl = `https://genius.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      return res.status(502).json({ message: 'Genius oEmbed request failed' });
    }

    const data = await response.json();

    // Extract song ID from embed HTML: data-song-id="1234567"
    const match = data.html && data.html.match(/data-song-id=['"](\d+)['"]/);
    if (!match) {
      return res.status(502).json({ message: 'Could not extract song ID from Genius embed' });
    }

    res.json({
      songId:    match[1],
      title:     data.title     || null,
      thumbnail: data.thumbnail_url || null,
    });
  } catch (error) {
    console.error('Genius oEmbed error:', error.message);
    res.status(500).json({ message: 'Server error fetching Genius embed' });
  }
});

export default router;
