-- Migration: expanded submission system
-- Run once: node run-migration.js add-submission-fields.sql

-- 1. New optional columns
ALTER TABLE music_submissions
  ADD COLUMN IF NOT EXISTS genre           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS instagram_url   TEXT,
  ADD COLUMN IF NOT EXISTS apple_music_url TEXT,
  ADD COLUMN IF NOT EXISTS genius_song_url TEXT,
  ADD COLUMN IF NOT EXISTS genius_lyrics   TEXT;

-- 2. Make payment_id nullable (free submissions have no Stripe ID)
ALTER TABLE music_submissions ALTER COLUMN payment_id DROP NOT NULL;

-- 3. Expand submission_type check constraint to include new types
DO $$
BEGIN
  ALTER TABLE music_submissions DROP CONSTRAINT IF EXISTS music_submissions_submission_type_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE music_submissions
  ADD CONSTRAINT music_submissions_submission_type_check
  CHECK (submission_type IN ('regular', 'featured', 'free', 'priority', 'genius'));
