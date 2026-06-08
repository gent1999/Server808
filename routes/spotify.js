import express from 'express';
import fetch from 'node-fetch';
import pool from '../config/db.js';

const router = express.Router();

// ── Spotify token cache (client credentials — public data only) ───────────────
let _token    = null;
let _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;

  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!r.ok) throw new Error(`Spotify token error ${r.status}`);
  const d = await r.json();
  _token    = d.access_token;
  _tokenExp = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

// ── Extract Spotify type + ID from any embed/open URL ────────────────────────
function parseSpotifyUrl(url) {
  const m = url.match(/\/(playlist|album|track|artist)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  return { type: m[1], id: m[2] };
}

// ── Fetch one Spotify resource (playlist, album, track, or artist) ────────────
async function fetchSpotifyItem(type, id, token) {
  const endpoints = {
    playlist: `playlists/${id}?fields=id,name,description,images,followers,tracks(total),external_urls,owner(display_name)`,
    album:    `albums/${id}?market=US`,
    track:    `tracks/${id}?market=US`,
    artist:   `artists/${id}`,
  };
  const ep = endpoints[type];
  if (!ep) return null;

  const r = await fetch(`https://api.spotify.com/v1/${ep}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
}

// ── Normalise into a common shape ─────────────────────────────────────────────
function normalise(type, raw) {
  if (!raw) return null;
  if (type === 'playlist') {
    return {
      type:         'playlist',
      name:         raw.name,
      description:  raw.description || '',
      image:        raw.images?.[0]?.url || null,
      followers:    raw.followers?.total ?? null,
      trackCount:   raw.tracks?.total ?? null,
      owner:        raw.owner?.display_name || null,
      spotifyUrl:   raw.external_urls?.spotify || null,
    };
  }
  if (type === 'album') {
    return {
      type:       'album',
      name:       raw.name,
      description:`by ${raw.artists?.map(a => a.name).join(', ')} · ${raw.release_date?.slice(0,4) || ''}`,
      image:      raw.images?.[0]?.url || null,
      followers:  null,
      trackCount: raw.tracks?.total ?? null,
      owner:      raw.artists?.[0]?.name || null,
      spotifyUrl: raw.external_urls?.spotify || null,
    };
  }
  if (type === 'track') {
    return {
      type:       'track',
      name:       raw.name,
      description:`by ${raw.artists?.map(a => a.name).join(', ')}`,
      image:      raw.album?.images?.[0]?.url || null,
      followers:  null,
      trackCount: null,
      owner:      raw.artists?.[0]?.name || null,
      spotifyUrl: raw.external_urls?.spotify || null,
    };
  }
  if (type === 'artist') {
    return {
      type:       'artist',
      name:       raw.name,
      description:`${raw.genres?.slice(0,2).join(', ') || ''}`,
      image:      raw.images?.[0]?.url || null,
      followers:  raw.followers?.total ?? null,
      trackCount: null,
      owner:      null,
      spotifyUrl: raw.external_urls?.spotify || null,
    };
  }
  return null;
}

// ── @route GET /api/spotify/metadata ─────────────────────────────────────────
// Returns all cry808 spotify_embeds enriched with live Spotify metadata.
// No auth required (public Spotify data via client credentials).
router.get('/metadata', async (req, res) => {
  try {
    // Load stored embeds from DB
    const { rows } = await pool.query(
      "SELECT * FROM spotify_embeds WHERE site = 'cry808' ORDER BY display_order ASC, created_at DESC"
    );

    // If no Spotify creds configured, return embeds without metadata
    let token = null;
    try { token = await getToken(); } catch (_) {}

    const enriched = await Promise.all(
      rows.map(async (embed) => {
        const parsed = parseSpotifyUrl(embed.spotify_url);
        let metadata = null;

        if (token && parsed) {
          const raw = await fetchSpotifyItem(parsed.type, parsed.id, token);
          metadata = normalise(parsed.type, raw);
        }

        return { ...embed, metadata };
      })
    );

    res.json({ embeds: enriched, credentialsConfigured: !!token });
  } catch (err) {
    console.error('[Spotify] metadata error:', err.message);
    res.status(500).json({ message: 'Failed to fetch Spotify metadata' });
  }
});

export default router;
