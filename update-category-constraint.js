import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function updateCategoryConstraint() {
  try {
    console.log('Updating category constraint to allow "guides"...');

    // Drop old constraint
    await pool.query(`
      ALTER TABLE articles
      DROP CONSTRAINT IF EXISTS articles_category_check
    `);

    // Add new constraint with 'guides' included
    await pool.query(`
      ALTER TABLE articles
      ADD CONSTRAINT articles_category_check
      CHECK (category IN ('article', 'interview', 'guides'))
    `);

    console.log('✅ Successfully updated category constraint! Now includes: article, interview, guides');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

updateCategoryConstraint();
