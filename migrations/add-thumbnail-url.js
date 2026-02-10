import pool from '../config/db.js';

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE articles
      ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    `);
    console.log('Migration successful: added thumbnail_url column to articles');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrate();
