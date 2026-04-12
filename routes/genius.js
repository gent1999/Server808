import express from 'express';
import { parse as parseHtml } from 'node-html-parser';

const router = express.Router();

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
    .trim()
    .replace(/^\d+\s*Contributors?\s*.+?Lyrics/s, '')
    .trim();
}

// @route   GET /api/genius-lyrics?url=
// @desc    Fetch lyrics for a Genius song URL
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  try {
    // Fetch Genius page via allorigins proxy (bypasses Vercel IP block).
    // Single HTTP call — no API search step needed since we already have the URL.
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000), // stay under Vercel's 10s limit
    });

    if (!response.ok) {
      return res.status(502).json({ message: `Proxy returned ${response.status}` });
    }

    const html = await response.text();
    const lyrics = extractLyrics(html);

    if (!lyrics) {
      return res.status(404).json({ message: 'Lyrics not found on page' });
    }

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/\s*[\|–]\s*Genius.*$/i, '').trim()
      : null;

    res.json({ lyrics, title });
  } catch (error) {
    console.error('[genius-lyrics] error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
