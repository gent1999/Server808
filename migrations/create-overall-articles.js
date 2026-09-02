import pool from '../config/db.js';

async function createOverallArticles() {
  const client = await pool.connect();

  try {
    console.log('Creating overall_articles join table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS overall_articles (
        overall_id INTEGER NOT NULL REFERENCES overalls(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (overall_id, article_id)
      );
    `);
    console.log('✓ Table created');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_overall_articles_article_id ON overall_articles(article_id);
    `);
    console.log('✓ Index created');

  } catch (error) {
    console.error('Error creating overall_articles:', error);
    throw error;
  } finally {
    client.release();
  }
}

createOverallArticles()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
