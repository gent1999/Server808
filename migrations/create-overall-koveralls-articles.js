import pool from '../config/db.js';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS overall_koveralls_articles (
        overall_id INTEGER NOT NULL REFERENCES overalls(id) ON DELETE CASCADE,
        koveralls_article_id INTEGER NOT NULL REFERENCES koveralls_articles(id) ON DELETE CASCADE,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (overall_id, koveralls_article_id)
      );
    `);
    console.log('Migration successful: created overall_koveralls_articles table');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_overall_koveralls_articles_article_id
      ON overall_koveralls_articles(koveralls_article_id);
    `);
    console.log('Migration successful: created index');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
