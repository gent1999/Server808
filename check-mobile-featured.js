import dotenv from 'dotenv';
import pool from './config/db.js';

dotenv.config();

async function checkMobileFeatured() {
  try {
    const result = await pool.query('SELECT id, name, is_mobile_featured, is_active FROM amazon_products');

    console.log('Amazon Products:');
    result.rows.forEach(p => {
      console.log(`  ID: ${p.id}, Name: ${p.name}, Active: ${p.is_active}, Mobile Featured: ${p.is_mobile_featured}`);
    });

    const mobileFeatured = result.rows.filter(p => p.is_mobile_featured);
    if (mobileFeatured.length === 0) {
      console.log('\n⚠️  No product is marked as mobile featured!');
    } else {
      console.log(`\n✅ Mobile featured product: ${mobileFeatured[0].name}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMobileFeatured();
