/**
 * Database compatibility wrapper for campaigns feature
 * Provides backward compatibility with the old database import pattern
 */

const { query, pool } = require('../shared/database/connection');

// Export db object with query method to match existing campaigns code
module.exports = {
  query: query,
  pool: pool
};