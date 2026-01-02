/**
 * Schema Checker Utility
 * Checks column existence and caches results to avoid repeated database queries
 * Production-grade solution for multi-tenant vs single-tenant schema compatibility
 */

const { pool } = require('./database');
const logger = require('../utils/logger');

// Memory cache for column existence checks
const columnCache = new Map();
const cacheExpiry = 60 * 60 * 1000; // 1 hour cache
let lastLogTime = {};

/**
 * Check if a column exists in a table
 * @param {string} schema - Schema name (e.g., 'lad_dev', 'public')
 * @param {string} tableName - Table name without schema prefix
 * @param {string} columnName - Column name to check
 * @returns {Promise<boolean>} - True if column exists
 */
async function hasColumn(schema, tableName, columnName) {
  const cacheKey = `${schema}.${tableName}.${columnName}`;
  const cached = columnCache.get(cacheKey);
  
  // Return cached result if still valid
  if (cached && (Date.now() - cached.timestamp) < cacheExpiry) {
    return cached.exists;
  }
  
  try {
    const query = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = $1 
        AND table_name = $2 
        AND column_name = $3
    `;
    
    const result = await pool.query(query, [schema, tableName, columnName]);
    const exists = result.rows.length > 0;
    
    // Cache the result
    columnCache.set(cacheKey, {
      exists,
      timestamp: Date.now()
    });
    
    // Log schema detection once per hour to avoid spam
    const logKey = `${schema}.${tableName}`;
    if (!lastLogTime[logKey] || (Date.now() - lastLogTime[logKey]) > cacheExpiry) {
      logger.info(`[Schema Check] ${schema}.${tableName}.${columnName}: ${exists ? 'EXISTS' : 'MISSING'}`, {
        schema,
        tableName,
        columnName,
        exists
      });
      lastLogTime[logKey] = Date.now();
    }
    
    return exists;
  } catch (error) {
    logger.error(`[Schema Check] Error checking column existence: ${error.message}`, {
      schema,
      tableName,
      columnName,
      error: error.message
    });
    // Default to false on error - safer for legacy schemas
    return false;
  }
}

/**
 * Check if a table exists
 * @param {string} schema - Schema name
 * @param {string} tableName - Table name without schema prefix
 * @returns {Promise<boolean>} - True if table exists
 */
async function hasTable(schema, tableName) {
  const cacheKey = `${schema}.${tableName}._table_`;
  const cached = columnCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < cacheExpiry) {
    return cached.exists;
  }
  
  try {
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
        AND table_name = $2
    `;
    
    const result = await pool.query(query, [schema, tableName]);
    const exists = result.rows.length > 0;
    
    columnCache.set(cacheKey, {
      exists,
      timestamp: Date.now()
    });
    
    return exists;
  } catch (error) {
    logger.error(`[Schema Check] Error checking table existence: ${error.message}`, {
      schema,
      tableName,
      error: error.message
    });
    return false;
  }
}

/**
 * Clear the schema cache (useful for testing or schema migrations)
 */
function clearCache() {
  columnCache.clear();
  lastLogTime = {};
  logger.info('[Schema Check] Cache cleared');
}

module.exports = {
  hasColumn,
  hasTable,
  clearCache
};
