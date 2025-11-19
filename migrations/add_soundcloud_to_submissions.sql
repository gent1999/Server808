-- Add soundcloud_url column to music_submissions table
ALTER TABLE music_submissions ADD COLUMN IF NOT EXISTS soundcloud_url TEXT;
