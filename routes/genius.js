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

/** Step 2a: Search lrclib.net */
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

/** Step 2b: Fallback — lyrics.ovh */
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

    // Try lrclib first, then lyrics.ovh
    const result =
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
