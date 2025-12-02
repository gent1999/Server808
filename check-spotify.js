import pool from './config/db.js';

(async () => {
  try {
    const result = await pool.query('SELECT id, title, page_type, is_active, created_at FROM spotify_embeds ORDER BY created_at DESC');
    console.log('Spotify Embeds in DB:');
    console.table(result.rows);
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
})();
