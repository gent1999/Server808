import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigration = async (filename) => {
  try {
    const migrationPath = path.join(__dirname, 'migrations', filename);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`Running migration: ${filename}`);
    await pool.query(sql);
    console.log(`✅ Migration ${filename} completed successfully`);

    process.exit(0);
  } catch (error) {
    console.error(`❌ Migration failed:`, error);
    process.exit(1);
  }
};

// Get filename from command line argument
const filename = process.argv[2];

if (!filename) {
  console.error('Please provide a migration filename');
  console.log('Usage: node run-migration.js <filename>');
  console.log('Example: node run-migration.js create_settings.sql');
  process.exit(1);
}

runMigration(filename);
