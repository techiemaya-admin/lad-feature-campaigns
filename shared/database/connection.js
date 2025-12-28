/**
 * Shared Database Connection
 * Provides access to the database pool from sts-service
 */

let pool;
let getDatabaseStatus;
let setDatabaseStatus;

// LAD Architecture: Use logger instead of console
const logger = require('../../backend/core/utils/logger');

try {
  // Import from sts-service config
  // Path: lad-feature-campaigns/shared/database/ -> sts-service/src/config/postgres
  const postgresConfig = require('../../../sts-service/src/config/postgres');
  pool = postgresConfig.pool;
  getDatabaseStatus = postgresConfig.getDatabaseStatus || (() => true);
  setDatabaseStatus = postgresConfig.setDatabaseStatus || (() => {});
  logger.info('[Campaigns DB] Database connection loaded successfully');
} catch (error) {
  logger.error('[Campaigns DB] Failed to load database connection', { 
    error: error.message, 
    stack: error.stack 
  });
  
  // Create a stub pool that will log errors
  pool = {
    query: async (query, params) => {
      logger.error('[Campaigns DB] Database query attempted but pool not available', { 
        query, 
        params 
      });
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

