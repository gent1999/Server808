-- Add soundcloud_url column to articles table for SoundCloud embeds
ALTER TABLE articles ADD COLUMN IF NOT EXISTS soundcloud_url TEXT;
