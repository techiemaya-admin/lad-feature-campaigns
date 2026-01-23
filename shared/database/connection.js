/**
 * Shared Database Connection
 * Provides access to the database pool from sts-service
 */

const { Pool } = require('pg');

let pool;
let getDatabaseStatus;
let setDatabaseStatus;
let databaseConnected = false;

try {
  // Try to import from sts-service if running as plugin
  const postgresConfig = require('../../../sts-service/src/config/postgres');
  pool = postgresConfig.pool;
  getDatabaseStatus = postgresConfig.getDatabaseStatus || (() => true);
  setDatabaseStatus = postgresConfig.setDatabaseStatus || (() => {});
  databaseConnected = true;
} catch (error) {
  // Fallback: Create standalone connection using environment variables
  
  try {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'salesmaya_agent',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    pool.query('SELECT NOW()', (err) => {
      if (err) {
        databaseConnected = false;
      } else {
        databaseConnected = true;
      }
    });

    getDatabaseStatus = () => databaseConnected;
    setDatabaseStatus = (status) => { databaseConnected = status; };
    
  } catch (initError) {
    console.error('[Campaigns DB] Failed to initialize database connection:', initError.message);
    
    // Create stub pool
    pool = {
      query: async () => {
        throw new Error('Database connection not available');
      }
    };
    
    getDatabaseStatus = () => false;
    setDatabaseStatus = () => {};
  }
}

// Export db as alias for pool (for Knex-style compatibility)
const db = pool;

module.exports = {
  pool,
  db,
  getDatabaseStatus,
  setDatabaseStatus
};
