-- Add individual toggle for article bottom banner (970x90)
INSERT INTO settings (key, value, description)
VALUES ('beatport_article_bottom_enabled', 'true', 'Enable Loopcloud 970x90 banner at bottom of article pages (desktop)')
ON CONFLICT (key) DO NOTHING;
