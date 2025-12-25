/**
 * Shared Database Connection
 * Provides access to the database pool from sts-service
 */

let pool;
let getDatabaseStatus;
let setDatabaseStatus;

try {
  // Import from sts-service config
  // Path: lad-feature-campaigns/shared/database/ -> sts-service/src/config/postgres
  const postgresConfig = require('../../../sts-service/src/config/postgres');
  pool = postgresConfig.pool;
  getDatabaseStatus = postgresConfig.getDatabaseStatus || (() => true);
  setDatabaseStatus = postgresConfig.setDatabaseStatus || (() => {});
  console.log('[Campaigns DB] ✅ Database connection loaded successfully');
} catch (error) {
  console.error('[Campaigns DB] ❌ Failed to load database connection:', error.message);
  console.error('[Campaigns DB] Stack:', error.stack);
  
  // Create a stub pool that will log errors
  pool = {
    query: async (query, params) => {
      console.error('[Campaigns DB] ❌ Database query attempted but pool not available!');
      console.error('[Campaigns DB] Query:', query);
      console.error('[Campaigns DB] Params:', params);
      throw new Error(`Database connection not available: ${error.message}`);
    }
  };
  
  getDatabaseStatus = () => false;
  setDatabaseStatus = () => {};
}

module.exports = {
  pool,
  getDatabaseStatus,
  setDatabaseStatus
};

