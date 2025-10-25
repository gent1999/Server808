-- Admins Table
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Articles Table
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  author VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  tags TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add spotify_url column to existing articles table
ALTER TABLE articles ADD COLUMN spotify_url TEXT;

-- Add youtube_url column to existing articles table
ALTER TABLE articles ADD COLUMN youtube_url TEXT;

-- Add category column to existing articles table (for articles vs interviews)
ALTER TABLE articles ADD COLUMN category VARCHAR(50) DEFAULT 'article' CHECK (category IN ('article', 'interview'));

-- Add is_featured column to articles table (only one article can be featured at a time)
ALTER TABLE articles ADD COLUMN is_featured BOOLEAN DEFAULT false;

-- Newsletter Subscribers Table
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);
