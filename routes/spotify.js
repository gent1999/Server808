import express from 'express';
import fetch from 'node-fetch';
import pool from '../config/db.js';

const router = express.Router();

// ── Token cache (client credentials) ─────────────────────────────────────────
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

// ── Parse Spotify URL → { type, id } ─────────────────────────────────────────
function parseSpotifyUrl(url) {
  const m = url?.match(/\/(playlist|album|track|artist)\/([A-Za-z0-9]+)/);
  return m ? { type: m[1], id: m[2] } : null;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function spotifyGet(path, token) {
  const r = await fetch(`https://api.spotify.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok ? r.json() : null;
}

// ── Fetch + normalise by type ─────────────────────────────────────────────────
async function fetchAndNormalise(type, id, token) {
  if (type === 'playlist') {
    const raw = await spotifyGet(`playlists/${id}`, token);
    if (!raw) return null;
    return {
      type:          'playlist',
      name:          raw.name,
      description:   raw.description || '',
      image:         raw.images?.[0]?.url || null,
      followers:     raw.followers?.total ?? null,
      trackCount:    raw.tracks?.total ?? null,
      owner:         raw.owner?.display_name || null,
      isPublic:      raw.public ?? null,
      collaborative: raw.collaborative ?? false,
      spotifyUrl:    raw.external_urls?.spotify || null,
      // playlists have no popularity in the Spotify API
    };
  }

  if (type === 'album') {
    const raw = await spotifyGet(`albums/${id}?market=US`, token);
    if (!raw) return null;
    return {
      type:        'album',
      name:        raw.name,
      description: raw.artists?.map(a => a.name).join(', ') || '',
      image:       raw.images?.[0]?.url || null,
      followers:   null,
      trackCount:  raw.tracks?.total ?? null,
      owner:       raw.artists?.[0]?.name || null,
      releaseDate: raw.release_date || null,
      albumType:   raw.album_type || null,   // album | single | compilation
      label:       raw.label || null,
      genres:      raw.genres || [],
      popularity:  raw.popularity ?? null,   // 0–100
      spotifyUrl:  raw.external_urls?.spotify || null,
    };
  }

  if (type === 'track') {
    const [raw, features] = await Promise.all([
      spotifyGet(`tracks/${id}?market=US`, token),
      spotifyGet(`audio-features/${id}`, token),
    ]);
    if (!raw) return null;
    return {
      type:        'track',
      name:        raw.name,
      description: raw.artists?.map(a => a.name).join(', ') || '',
      image:       raw.album?.images?.[0]?.url || null,
      followers:   null,
      trackCount:  null,
      owner:       raw.artists?.[0]?.name || null,
      albumName:   raw.album?.name || null,
      releaseDate: raw.album?.release_date || null,
      durationMs:  raw.duration_ms ?? null,
      explicit:    raw.explicit ?? false,
      popularity:  raw.popularity ?? null,   // 0–100
      previewUrl:  raw.preview_url || null,
      spotifyUrl:  raw.external_urls?.spotify || null,
      // Audio features (null if not returned by API)
      bpm:              features ? Math.round(features.tempo) : null,
      energy:           features?.energy ?? null,         // 0–1
      danceability:     features?.danceability ?? null,   // 0–1
      valence:          features?.valence ?? null,        // 0–1 (happiness)
      acousticness:     features?.acousticness ?? null,   // 0–1
      instrumentalness: features?.instrumentalness ?? null,
      liveness:         features?.liveness ?? null,
      speechiness:      features?.speechiness ?? null,
      key:              features?.key ?? null,            // 0–11 (C=0)
      mode:             features?.mode ?? null,           // 0=minor 1=major
      loudness:         features ? Math.round(features.loudness * 10) / 10 : null, // dB
    };
  }

  if (type === 'artist') {
    const raw = await spotifyGet(`artists/${id}`, token);
    if (!raw) return null;
    return {
      type:       'artist',
      name:       raw.name,
      description:'',
      image:      raw.images?.[0]?.url || null,
      followers:  raw.followers?.total ?? null,
      trackCount: null,
      owner:      null,
      genres:     raw.genres || [],
      popularity: raw.popularity ?? null,   // 0–100
      spotifyUrl: raw.external_urls?.spotify || null,
    };
  }

  return null;
}

// ── GET /api/spotify/metadata ─────────────────────────────────────────────────
router.get('/metadata', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM spotify_embeds WHERE site = 'cry808' ORDER BY display_order ASC, created_at DESC"
    );

    let token = null;
    try { token = await getToken(); } catch (_) {}

    const enriched = await Promise.all(
      rows.map(async (embed) => {
        const parsed = parseSpotifyUrl(embed.spotify_url);
        const metadata = (token && parsed)
          ? await fetchAndNormalise(parsed.type, parsed.id, token).catch(() => null)
          : null;
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
