-- Add order setting for Spotify embed in article sidebar
INSERT INTO settings (key, value, description)
VALUES ('spotify_article_order', '3', 'Display order for Spotify embed in article sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;
