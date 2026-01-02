/**
 * Schema Helper for Campaigns Feature
 * Returns appropriate schema based on environment and table availability
 */

const config = require('../config');
const logger = require('./logger');

let detectedSchema = null;
let schemaCheckDone = false;

async function detectSchema() {
  if (schemaCheckDone) {
    return detectedSchema;
  }
  
  try {
    const { pool } = require('../../features/campaigns/utils/dbConnection');
    const targetSchema = config.DB_SCHEMA || 'public';
    
    // Check if target schema has campaigns table with tenant_id
    const schemaCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = $1 
        AND table_name = 'campaigns' 
        AND column_name = 'tenant_id'
    `, [targetSchema]);
    
    if (schemaCheck.rows.length > 0) {
      detectedSchema = targetSchema;
      logger.info('Schema detected with tenant_id support', { schema: targetSchema });
    } else {
      // Fallback to public schema for legacy installations
      detectedSchema = 'public';
      logger.info('Using public schema (legacy mode)', { fallback: true });
    }
  } catch (error) {
    logger.warn('Schema detection failed, defaulting to public', { error: error.message });
    detectedSchema = 'public';
  }
  
  schemaCheckDone = true;
  return detectedSchema;
}

function getSchema(req = null) {
  // Return configured schema or detected schema
  return config.DB_SCHEMA || detectedSchema || 'public';
}

module.exports = { getSchema, detectSchema };
