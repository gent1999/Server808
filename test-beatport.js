import pool from './config/db.js';

const check = async () => {
  try {
    const result = await pool.query("SELECT * FROM settings WHERE key LIKE 'beatport%' ORDER BY key");
    console.log('Beatport settings in database:');
    result.rows.forEach(row => {
      console.log(`  ${row.key}: ${row.value}`);
    });
    
    // Also check all settings
    const all = await pool.query("SELECT * FROM settings ORDER BY key");
    console.log('\nAll settings:');
    all.rows.forEach(row => {
      console.log(`  ${row.key}: ${row.value}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
};

check();
