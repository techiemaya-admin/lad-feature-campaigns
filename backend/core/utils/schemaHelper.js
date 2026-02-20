/**
 * Schema Helper - Dynamic schema resolution for multi-tenant support
 * 
 * Usage:
 *   const { getSchema } = require('../../../../core/utils/schemaHelper');
 *   const schema = getSchema(req);
 *   await pool.query(`SELECT * FROM ${schema}.campaigns WHERE id = $1`, [id]);
 */

/**
 * Get the database schema for the current request/context
 * Priority: req.user.schema > tenant.schema > env variable > default
 * 
 * @param {Object} req - Express request object (optional)
 * @param {Object} options - Override options
 * @returns {string} Schema name
 */
function getSchema(req = null, options = {}) {
  // 1. Check explicit override
  if (options.schema) {
    return options.schema;
  }

  // 2. Check request user object (most common in authenticated routes)
  if (req?.user?.schema) {
    return req.user.schema;
  }

  // 3. Check tenant object (if passed separately)
  if (req?.tenant?.schema) {
    return req.tenant.schema;
  }

  // 4. Check environment variable (DB_SCHEMA or POSTGRES_SCHEMA)
  if (process.env.DB_SCHEMA) {
    return process.env.DB_SCHEMA;
  }
  
  if (process.env.POSTGRES_SCHEMA) {
    return process.env.POSTGRES_SCHEMA;
  }

  // 5. Default to lad_dev for development
  return 'lad_dev';
}

/**
 * Build a table reference with schema
 * 
 * @param {string} tableName - Table name without schema
 * @param {Object} req - Express request object (optional)
 * @returns {string} Fully qualified table name (schema.table)
 */
function getTable(tableName, req = null) {
  const schema = getSchema(req);
  return `${schema}.${tableName}`;
}

/**
 * Sanitize schema name to prevent SQL injection
 * 
 * @param {string} schema - Schema name to sanitize
 * @returns {string} Sanitized schema name
 */
function sanitizeSchema(schema) {
  // Only allow alphanumeric and underscore
  return schema.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Get tenant context (tenant_id and schema) from request
 * This is used by deals-pipeline controllers for LAD compatibility
 * 
 * @param {Object} req - Express request object
 * @returns {Object} Object with tenant_id and schema
 */
function getTenantContext(req) {
  const { getTenantId } = require('./tenantHelper');
  const logger = require('./logger');
  
  logger.debug('[getTenantContext] Called', { hasUser: !!req?.user, hasTenantHeader: !!req?.headers?.['x-tenant-id'] });
  
  try {
    // Try to get tenant ID using the safe getTenantId function
    let tenant_id = getTenantId(null, req);
    
    // If no tenant ID found, try some common fallbacks
    if (!tenant_id) {
      // Try to extract from user object
      tenant_id = req?.user?.tenantId || req?.user?.organizationId || req?.user?.clientId;
    }
    
    // If still no tenant ID, this is an error condition
    if (!tenant_id) {
      const error = new Error('Tenant context required but not found in request');
      error.code = 'TENANT_CONTEXT_MISSING';
      throw error;
    }
    
    const schema = getSchema(req);
    
    logger.debug('[getTenantContext] Success', { tenant_id, schema });
    return { tenant_id, schema };
  } catch (error) {
    logger.error('[getTenantContext] Error', { error: error.message });
    const errorWithCode = new Error('Failed to determine tenant context: ' + error.message);
    errorWithCode.code = 'TENANT_CONTEXT_MISSING';
    throw errorWithCode;
  }
}

module.exports = {
  getSchema,
  getTable,
  sanitizeSchema,
  getTenantContext,
  DEFAULT_SCHEMA: 'lad_dev'
};
