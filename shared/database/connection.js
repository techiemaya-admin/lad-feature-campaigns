/**
 * Real Database Connection
 * Connects to PostgreSQL database using environment variables
 */

const { Pool } = require('pg');

// PRODUCTION VALIDATION: Fail fast if required env vars missing
if (process.env.NODE_ENV === 'production') {
  const required = ['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required database environment variables in production: ${missing.join(', ')}`);
  }
}

// Create PostgreSQL pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: parseInt(process.env.POSTGRES_MAX_CLIENTS || '10'),
  idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: 5000,
});

// Log connection
pool.on('connect', () => {
  // Database connected successfully
});

pool.on('error', (err) => {
  // Handle unexpected database errors
});

// Export both pool and query function
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
};
