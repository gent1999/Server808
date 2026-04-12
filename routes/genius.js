import express from 'express';

const router = express.Router();

/**
 * Extracts lyrics text from raw Genius page HTML.
 * Genius server-renders lyrics inside divs with data-lyrics-container="true".
 */
function extractLyrics(html) {
  const sections = [];
  let searchFrom = 0;

  while (true) {
    const markerIdx = html.indexOf('data-lyrics-container="true"', searchFrom);
    if (markerIdx === -1) break;

    const openTagEnd = html.indexOf('>', markerIdx) + 1;

    // Walk forward counting div depth to find the matching closing tag
    let depth = 1;
    let i = openTagEnd;
    while (i < html.length && depth > 0) {
      const nextOpen  = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div', i);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          const inner = html.slice(openTagEnd, nextClose);
          sections.push(inner);
        }
        i = nextClose + 6;
      }
    }

    searchFrom = openTagEnd;
  }

  if (sections.length === 0) return null;

  return sections
    .map(s =>
      s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    )
    .join('\n\n');
}

// @route   GET /api/genius-lyrics
// @desc    Scrape and return lyrics text from a Genius song page
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ message: `Genius returned ${response.status}` });
    }

    const html = await response.text();
    const lyrics = extractLyrics(html);

    if (!lyrics) {
      return res.status(404).json({ message: 'No lyrics found on this page' });
    }

    // Extract title from <title> tag as a bonus
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(' | Genius Lyrics', '').trim() : null;

    res.json({ lyrics, title });
  } catch (error) {
    console.error('Genius lyrics scrape error:', error.message);
    res.status(500).json({ message: 'Failed to fetch lyrics' });
  }
});

export default router;
