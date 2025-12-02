-- Add page_type column to spotify_embeds table
ALTER TABLE spotify_embeds ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'home';

-- Set existing embeds to 'home' by default
UPDATE spotify_embeds SET page_type = 'home' WHERE page_type IS NULL;
