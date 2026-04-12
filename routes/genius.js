import express from 'express';
import { Client } from 'genius-lyrics';
import { parse as parseHtml } from 'node-html-parser';

const router = express.Router();

/**
 * Fetch the Genius lyrics page via allorigins.win proxy.
 * Genius IP-blocks Vercel's servers; allorigins routes through neutral IPs.
 */
async function fetchLyricsHtml(songUrl) {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(songUrl)}`;
  const res = await fetch(proxyUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
  return res.text();
}

/**
 * Parse lyrics from Genius HTML using the same selector genius-lyrics uses.
 */
function extractLyrics(html) {
  const root = parseHtml(html);
  const containers = root.querySelectorAll("[data-lyrics-container='true']");
  if (!containers.length) return null;

  return containers
    .map(el => {
      el.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      return el.text;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// @route   GET /api/genius-lyrics?url=
// @desc    Fetch lyrics for a Genius song URL
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ message: 'GENIUS_ACCESS_TOKEN not configured' });

  try {
    // Use Genius API (not blocked) to find the exact song
    const client = new Client(token);
    const slug = new URL(url).pathname
      .replace(/^\//, '')
      .replace(/-lyrics$/, '')
      .replace(/-/g, ' ')
      .trim();

    const results = await client.songs.search(slug);
    if (!results.length) {
      return res.status(404).json({ message: 'Song not found on Genius' });
    }

    const song = results.find(s => s.url?.toLowerCase() === url.toLowerCase()) || results[0];

    // Fetch the lyrics page via proxy (bypasses Genius IP block on Vercel)
    const html = await fetchLyricsHtml(song.url);
    let lyrics = extractLyrics(html);

    if (!lyrics) {
      return res.status(404).json({ message: 'Lyrics not found on page' });
    }

    // Strip "N Contributor(s)Song Title Lyrics" header
    lyrics = lyrics.replace(/^\d+\s*Contributors?\s*.+?Lyrics/s, '').trim();

    res.json({
      lyrics,
      title: `${song.artist?.name || ''} – ${song.title || ''}`.trim(),
    });
  } catch (error) {
    console.error('[genius-lyrics] error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
