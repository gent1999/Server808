-- Create settings table for ad network configuration
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value BOOLEAN DEFAULT false,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster key lookups
CREATE INDEX idx_settings_key ON settings(key);

-- Insert default ad network settings
INSERT INTO settings (key, value, description)
VALUES
  ('adsterra_enabled', false, 'Enable Adsterra ads on home page'),
  ('hilltop_enabled', true, 'Enable Hilltop ads on article detail pages'),
  ('monetag_enabled', false, 'Enable Monetag ads (future use)')
ON CONFLICT (key) DO NOTHING;
