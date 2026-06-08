-- Migration: add new columns for expanded submission system
-- Run this once against your Neon DB before deploying the new submission code.

-- 1. New columns
ALTER TABLE music_submissions
  ADD COLUMN IF NOT EXISTS genre          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS instagram_url  TEXT,
  ADD COLUMN IF NOT EXISTS apple_music_url TEXT,
  ADD COLUMN IF NOT EXISTS genius_song_url TEXT,
  ADD COLUMN IF NOT EXISTS genius_lyrics   TEXT;

-- 2. Update the submission_type check constraint to include new types
DO $$
BEGIN
  -- Drop the old constraint if it exists (name may vary — cover both possibilities)
  ALTER TABLE music_submissions DROP CONSTRAINT IF EXISTS music_submissions_submission_type_check;
  ALTER TABLE music_submissions DROP CONSTRAINT IF EXISTS submissions_submission_type_check;
EXCEPTION WHEN OTHERS THEN
  NULL; -- constraint may not exist, that's fine
END $$;

ALTER TABLE music_submissions
  ADD CONSTRAINT music_submissions_submission_type_check
  CHECK (submission_type IN ('regular', 'featured', 'free', 'priority', 'genius'));
