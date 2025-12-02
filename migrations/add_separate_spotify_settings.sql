-- Add separate Spotify embed URLs for home and article pages
INSERT INTO settings (key, value, description)
VALUES ('spotify_home_url', '', 'Spotify embed URL for home page sidebar')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('spotify_home_title', 'Featured Playlist', 'Title for Spotify embed on home page')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('spotify_article_url', '', 'Spotify embed URL for article page sidebar')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('spotify_article_title', 'Featured Playlist', 'Title for Spotify embed on article page')
ON CONFLICT (key) DO NOTHING;
