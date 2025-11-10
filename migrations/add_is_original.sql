-- Add is_original column to articles table for 1of1 Originals section
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_original BOOLEAN DEFAULT false;
