-- Add order settings for sidebar components
INSERT INTO settings (key, value, description)
VALUES ('adsterra_order', '1', 'Display order for Adsterra ads in sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('beatport_sidebar_order', '2', 'Display order for Beatport/Loopcloud banner in sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('spotify_order', '3', 'Display order for Spotify embed in sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('amazon_order', '4', 'Display order for Amazon products in sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;
