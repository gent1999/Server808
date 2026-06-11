// routes/playlistSubmissions.js
// Playlist submission queue — Soundplate auto-import + manual admin management.
// All routes require admin auth (JWT from login).

import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// ── Boot migration (idempotent) ───────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS playlist_submissions (
    id               SERIAL PRIMARY KEY,
    artist           TEXT NOT NULL,
    track            TEXT,
    spotify_url      TEXT,
    playlist         TEXT NOT NULL DEFAULT 'Press Play',
    source           TEXT NOT NULL DEFAULT 'Soundplate',
    status           TEXT NOT NULL DEFAULT 'Pending Review'
                     CHECK (status IN ('Pending Review', 'Approved', 'Removed from Playlist', 'Declined')),
    submitted_at     TIMESTAMPTZ DEFAULT NOW(),
    notes            TEXT DEFAULT '',
    gmail_message_id TEXT UNIQUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pl_subs_status    ON playlist_submissions(status);
  CREATE INDEX IF NOT EXISTS idx_pl_subs_submitted ON playlist_submissions(submitted_at DESC);
`).catch(err => console.warn('[playlist-submissions] boot migration:', err.message));

// ── GET /api/playlist-submissions ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM playlist_submissions ORDER BY submitted_at DESC'
    );
    res.json({ submissions: rows, count: rows.length });
  } catch (err) {
    console.error('[playlist-submissions] GET error:', err.message);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// ── POST /api/playlist-submissions/import ─────────────────────────────────────
// Used by the 808-engine Soundplate importer and the dashboard "Add" form.
// gmail_message_id is unique — duplicate emails are silently skipped.
router.post('/import', async (req, res) => {
  const { artist, track, spotify_url, playlist, source, gmail_message_id, submitted_at, notes } = req.body;

  if (!artist?.trim()) return res.status(400).json({ message: 'artist is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO playlist_submissions
         (artist, track, spotify_url, playlist, source, gmail_message_id, submitted_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (gmail_message_id) DO UPDATE
         SET artist     = EXCLUDED.artist,
             track      = EXCLUDED.track,
             updated_at = NOW()
         WHERE playlist_submissions.track IS NULL
           AND EXCLUDED.track IS NOT NULL
       RETURNING *, (xmax = 0) AS inserted`,
      [
        artist.trim(),
        track?.trim() || null,
        spotify_url || null,
        playlist || 'Press Play',
        source || 'Soundplate',
        gmail_message_id || null,
        submitted_at ? new Date(submitted_at) : new Date(),
        notes || '',
      ]
    );

    if (!rows.length) {
      // Conflict existed AND the update condition was not met (track already set)
      return res.json({ message: 'Already imported (duplicate)', skipped: true });
    }

    if (!rows[0].inserted) {
      // Row existed but we just patched its artist/track
      return res.status(200).json({ message: 'Submission updated (track fixed)', submission: rows[0] });
    }

    res.status(201).json({ message: 'Submission imported', submission: rows[0] });
  } catch (err) {
    console.error('[playlist-submissions] POST /import error:', err.message);
    res.status(500).json({ message: 'Failed to import submission' });
  }
});

// ── PUT /api/playlist-submissions/:id ────────────────────────────────────────
// Update status, notes, spotify_url, or playlist.
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { status, notes, spotify_url, playlist } = req.body;

  const VALID = ['Pending Review', 'Approved', 'Removed from Playlist', 'Declined'];
  if (status && !VALID.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE playlist_submissions
       SET status      = COALESCE($1, status),
           notes       = COALESCE($2, notes),
           spotify_url = COALESCE($3, spotify_url),
           playlist    = COALESCE($4, playlist),
           updated_at  = NOW()
       WHERE id = $5
       RETURNING *`,
      [status || null, notes ?? null, spotify_url || null, playlist || null, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Submission not found' });
    res.json({ message: 'Updated', submission: rows[0] });
  } catch (err) {
    console.error('[playlist-submissions] PUT error:', err.message);
    res.status(500).json({ message: 'Failed to update submission' });
  }
});

// ── DELETE /api/playlist-submissions/:id ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM playlist_submissions WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (err) {
    console.error('[playlist-submissions] DELETE error:', err.message);
    res.status(500).json({ message: 'Failed to delete submission' });
  }
});

export default router;
