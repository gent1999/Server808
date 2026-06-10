-- Create playlist_submissions table for Soundplate auto-import
-- Run: node run-migration.js create_playlist_submissions.sql

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
