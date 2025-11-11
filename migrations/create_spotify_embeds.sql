-- Create spotify_embeds table
CREATE TABLE IF NOT EXISTS spotify_embeds (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  spotify_url TEXT NOT NULL,
  embed_type VARCHAR(50) DEFAULT 'playlist' CHECK (embed_type IN ('playlist', 'album', 'track', 'artist')),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX idx_spotify_embeds_active ON spotify_embeds(is_active);
CREATE INDEX idx_spotify_embeds_order ON spotify_embeds(display_order);

-- Insert sample data (optional)
-- INSERT INTO spotify_embeds (title, spotify_url, embed_type, is_active, display_order)
-- VALUES ('Top Hip-Hop Hits', 'https://open.spotify.com/embed/playlist/37i9dQZF1DX0XUsuxWHRQd', 'playlist', true, 1);
