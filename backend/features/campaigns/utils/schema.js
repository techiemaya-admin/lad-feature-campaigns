/**
 * Schema Helper Utility
 * LAD Architecture: Get schema from environment
 */

function getSchema(req) {
  // Get schema from environment or default to public
  return process.env.DB_SCHEMA || 'public';
}

module.exports = { getSchema };
