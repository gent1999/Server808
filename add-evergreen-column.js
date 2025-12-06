import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addEvergreenColumn() {
  try {
    console.log('Adding is_evergreen column to articles table...');

    await pool.query(`
      ALTER TABLE articles
      ADD COLUMN IF NOT EXISTS is_evergreen BOOLEAN DEFAULT FALSE
    `);

    console.log('✅ Successfully added is_evergreen column to articles table');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

addEvergreenColumn();
