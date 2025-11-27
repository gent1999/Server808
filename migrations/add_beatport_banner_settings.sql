-- First, change the value column from BOOLEAN to TEXT to support both boolean flags and text values
ALTER TABLE settings ALTER COLUMN value TYPE TEXT USING value::TEXT;

-- Add Beatport/Loopcloud banner settings to settings table (key-value format)
INSERT INTO settings (key, value, description)
VALUES ('beatport_banner_enabled', 'false', 'Enable Beatport/Loopcloud banner on home page sidebar')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('beatport_banner_url', '', 'Affiliate link URL for Beatport/Loopcloud banner')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('beatport_banner_image_url', '', 'Banner image URL for Beatport/Loopcloud banner')
ON CONFLICT (key) DO NOTHING;
