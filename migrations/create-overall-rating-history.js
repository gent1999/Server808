import pool from '../config/db.js';

async function createOverallRatingHistory() {
  const client = await pool.connect();

  try {
    console.log('Creating overall_rating_history table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS overall_rating_history (
        id SERIAL PRIMARY KEY,
        overall_id INTEGER NOT NULL REFERENCES overalls(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Table created');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orh_overall_id ON overall_rating_history(overall_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orh_recorded_at ON overall_rating_history(recorded_at DESC);
    `);
    console.log('✓ Indexes created');

    // Backfill: seed one history row per existing overall that already has a rating,
    // using its current rating and created_at, so history-derived fields (current/peak)
    // resolve correctly for pre-existing records without fabricating fake movement.
    const backfillResult = await client.query(`
      INSERT INTO overall_rating_history (overall_id, rating, recorded_at)
      SELECT o.id, o.overall, o.created_at
      FROM overalls o
      WHERE o.overall IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM overall_rating_history h WHERE h.overall_id = o.id
        );
    `);
    console.log(`✓ Backfilled ${backfillResult.rowCount} history rows for existing overalls`);

  } catch (error) {
    console.error('Error creating overall_rating_history:', error);
    throw error;
  } finally {
    client.release();
  }
}

createOverallRatingHistory()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
