-- Migration: Add spotify_url column to articles table
ALTER TABLE articles ADD COLUMN IF NOT EXISTS spotify_url TEXT;
