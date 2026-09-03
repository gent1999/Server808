import pool from '../config/db.js';

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS koveralls_articles (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        content TEXT NOT NULL,
        image_url TEXT,
        thumbnail_url TEXT,
        tags TEXT[],
        category TEXT NOT NULL DEFAULT 'article'
          CHECK (category IN ('article', 'interview', 'review', 'editorial', 'rating_update', 'rankings')),
        instagram_link TEXT,
        is_featured BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Migration successful: created koveralls_articles table');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrate();
