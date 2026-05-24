import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Create a pool for PostgreSQL connections
// Low limits so Neon's autosuspend can kick in between requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 3,                    // never hold more than 3 connections
  idleTimeoutMillis: 10000,  // release idle connections after 10s
  connectionTimeoutMillis: 5000, // fail fast if no connection available
});

// Test the connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

export default pool;
