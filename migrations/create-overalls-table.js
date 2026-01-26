import pool from '../config/db.js';

async function createOverallsTable() {
  const client = await pool.connect();

  try {
    console.log('Creating overalls table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS overalls (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        image_url TEXT NOT NULL,
        content TEXT NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✓ Overalls table created successfully');

    // Create index on slug for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_overalls_slug ON overalls(slug);
    `);

    console.log('✓ Index created on slug column');

    // Create index on created_at for sorting
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_overalls_created_at ON overalls(created_at DESC);
    `);

    console.log('✓ Index created on created_at column');

  } catch (error) {
    console.error('Error creating overalls table:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration
createOverallsTable()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
