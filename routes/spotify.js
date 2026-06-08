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

// ── Playlist insights: fetch tracks → audio features + artist genres ─────────
// Every sub-request is isolated so one failing endpoint never nulls out the rest.
async function fetchPlaylistInsights(id, token) {
  // 1. Fetch up to 50 tracks (required — if this fails we have nothing)
  let tracksRaw = null;
  try { tracksRaw = await spotifyGet(`playlists/${id}/tracks?limit=50&market=US`, token); } catch (_) {}
  if (!tracksRaw?.items?.length) return null;

  const tracks = tracksRaw.items
    .map(i => i?.track)
    .filter(t => t?.id && !t.is_local);   // remove null/unavailable/local entries

  if (!tracks.length) return null;

  const trackIds  = tracks.map(t => t.id);
  const artistIds = [...new Set(
    tracks.flatMap(t => (t.artists || []).map(a => a.id))
  )].slice(0, 50);

  // 2. Audio features — deprecated for newer apps, gracefully skip if absent
  let features = [];
  try {
    const raw = await spotifyGet(`audio-features?ids=${trackIds.join(',')}`, token);
    features = (raw?.audio_features || []).filter(Boolean);
  } catch (_) {}

  // 3. Artist genres — isolated so audio-features failure doesn't affect this
  let artists = [];
  try {
    if (artistIds.length) {
      const raw = await spotifyGet(`artists?ids=${artistIds.join(',')}`, token);
      artists = (raw?.artists || []).filter(Boolean);
    }
  } catch (_) {}

  // 4. Helpers
  const avg = (arr, key) => {
    const vals = arr.map(x => x?.[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const r2 = n => (n != null ? Math.round(n * 100) / 100 : null);

  // 5. Genre frequency
  const genreCount = {};
  artists.forEach(a =>
    (a.genres || []).forEach(g => { genreCount[g] = (genreCount[g] || 0) + 1; })
  );
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g]) => g);

  // 6. Top 3 tracks by popularity
  const topTracks = [...tracks]
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 3)
    .map(t => ({
      name:       t.name,
      artist:     t.artists?.[0]?.name || null,
      popularity: t.popularity ?? null,
    }));

  return {
    analyzedCount:   tracks.length,
    // audio features — null when endpoint is unavailable for this Spotify app
    avgBpm:          features.length ? Math.round(avg(features, 'tempo'))   : null,
    avgEnergy:       r2(avg(features, 'energy')),
    avgDanceability: r2(avg(features, 'danceability')),
    avgValence:      r2(avg(features, 'valence')),
    avgAcousticness: r2(avg(features, 'acousticness')),
    // always available as long as tracks loaded
    avgPopularity:   Math.round(avg(tracks, 'popularity') ?? 0) || null,
    topGenres,
    topTracks,
  };
}

// ── Fetch + normalise by type ─────────────────────────────────────────────────
async function fetchAndNormalise(type, id, token) {
  if (type === 'playlist') {
    const [raw, insights] = await Promise.all([
      spotifyGet(`playlists/${id}`, token),
      fetchPlaylistInsights(id, token),
    ]);
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
      insights,   // { avgBpm, avgEnergy, avgDanceability, avgValence, topGenres, topTracks, … }
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
