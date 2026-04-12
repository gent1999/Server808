import express from 'express';

const router = express.Router();

/** Converts Genius URL slug to a plain search string */
function slugToQuery(url) {
  try {
    const path = new URL(url).pathname;
    return path.replace(/^\//, '').replace(/-lyrics$/, '').replace(/-/g, ' ').trim();
  } catch {
    return null;
  }
}

/**
 * Step 1: Use Genius API to resolve proper artist + title from the URL.
 * Falls back to slug parsing if no token or API fails.
 */
async function resolveFromGenius(geniusUrl, query) {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return { artist: null, title: query };

  try {
    const res = await fetch(
      `https://api.genius.com/search?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { artist: null, title: query };

    const data = await res.json();
    const hits = data?.response?.hits || [];

    // Find the hit whose url matches the supplied Genius URL
    const match = hits.find(h =>
      h.result?.url?.toLowerCase() === geniusUrl.toLowerCase()
    ) || hits[0];

    if (!match) return { artist: null, title: query };

    return {
      artist: match.result.primary_artist?.name || null,
      title:  match.result.title || query,
    };
  } catch {
    return { artist: null, title: query };
  }
}

/** Extract lyrics from Genius HTML (same technique as lyricsgenius) */
function extractLyricsFromHtml(html) {
  const sections = [];
  let searchFrom = 0;
  while (true) {
    const markerIdx = html.indexOf('data-lyrics-container="true"', searchFrom);
    if (markerIdx === -1) break;
    const openTagEnd = html.indexOf('>', markerIdx) + 1;
    let depth = 1, i = openTagEnd;
    while (i < html.length && depth > 0) {
      const nextOpen  = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
      else {
        depth--;
        if (depth === 0) sections.push(html.slice(openTagEnd, nextClose));
        i = nextClose + 6;
      }
    }
    searchFrom = openTagEnd;
  }
  if (!sections.length) return null;
  return sections.map(s =>
    s.replace(/<br\s*\/?>/gi, '\n')
     .replace(/<[^>]+>/g, '')
     .replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
     .replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim()
  ).join('\n\n');
}

/**
 * Fetch Genius lyrics page with Bearer token — same approach as lyricsgenius.
 * Authenticated requests are not blocked by Genius bot detection.
 */
async function fetchFromGenius(geniusUrl, songTitle) {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(geniusUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const lyrics = extractLyricsFromHtml(html);
    return lyrics ? { lyrics, title: songTitle } : null;
  } catch {
    return null;
  }
}

/** Search lrclib.net */
async function fetchFromLrclib(artist, title) {
  const q = artist ? `${artist} ${title}` : title;
  const res = await fetch(
    `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': 'Cry808/1.0 (cry808.com)' } }
  );
  if (!res.ok) return null;
  const results = await res.json();
  const hit = results.find(r => r.plainLyrics);
  return hit ? { lyrics: hit.plainLyrics, title: `${hit.artistName} – ${hit.trackName}` } : null;
}

/** Fallback — lyrics.ovh */
async function fetchFromLyricsOvh(artist, title) {
  if (!artist) return null;
  const res = await fetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.lyrics ? { lyrics: data.lyrics, title: `${artist} – ${title}` } : null;
}

// @route   GET /api/genius-lyrics?url=
// @access  Public
router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'url query parameter is required' });

  const query = slugToQuery(url);
  if (!query) return res.status(400).json({ message: 'Invalid Genius URL' });

  try {
    const { artist, title } = await resolveFromGenius(url, query);

    // 1. Authenticated Genius scrape (lyricsgenius approach) — best quality
    // 2. lrclib.net
    // 3. lyrics.ovh
    const result =
      (await fetchFromGenius(url, `${artist || ''} – ${title}`)) ||
      (await fetchFromLrclib(artist, title)) ||
      (await fetchFromLyricsOvh(artist, title));

    if (!result) {
      return res.status(404).json({ message: 'No lyrics found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Lyrics fetch error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
