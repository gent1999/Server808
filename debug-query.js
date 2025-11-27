import pool from './config/db.js';

const check = async () => {
  try {
    // Run the exact same query as the public endpoint
    const result = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('adsterra_enabled', 'hilltop_enabled', 'monetag_enabled', 'beatport_banner_enabled', 'beatport_banner_url', 'beatport_banner_image_url')"
    );
    
    console.log('Query result:');
    console.log('Rows returned:', result.rows.length);
    result.rows.forEach(row => {
      console.log(`  ${row.key}: "${row.value}"`);
    });
    
    // Convert to object like the endpoint does
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    console.log('\nSettings object:');
    console.log(JSON.stringify(settings, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
};

check();
