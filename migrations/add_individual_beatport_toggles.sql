-- Add individual toggle settings for each Loopcloud banner
INSERT INTO settings (key, value, description)
VALUES ('beatport_home_desktop_enabled', 'true', 'Enable Loopcloud 300x250 banner on home page sidebar (desktop)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('beatport_home_mobile_enabled', 'true', 'Enable Loopcloud 300x50 banner on home page (mobile)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('beatport_article_desktop_enabled', 'true', 'Enable Loopcloud 970x90 banner on article pages (desktop)')
ON CONFLICT (key) DO NOTHING;
