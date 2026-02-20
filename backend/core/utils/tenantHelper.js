/**
 * Tenant Helper Utilities
 * LAD Architecture Compliant - Multi-tenancy helper functions
 * 
 * Provides utilities for extracting and validating tenant IDs from requests.
 */

const logger = require('./logger');

/**
 * Extract and validate tenant ID from request or explicit parameter
 * @param {string|null} explicitTenantId - Explicitly provided tenant ID
 * @param {Object|null} req - Express request object
 * @param {string} operationName - Name of the operation (for logging)
 * @returns {string} Validated tenant ID
 * @throws {Error} If tenant ID cannot be determined
 */
function requireTenantId(explicitTenantId = null, req = null, operationName = 'operation') {
  // 1. Use explicit tenant ID if provided
  if (explicitTenantId) {
    logger.debug('[TenantHelper] Using explicit tenant ID', { 
      tenantId: explicitTenantId, 
      operation: operationName 
    });
    return explicitTenantId;
  }

  // 2. Extract from request user object (set by auth middleware)
  if (req?.user?.tenantId) {
    logger.debug('[TenantHelper] Using tenant ID from req.user', { 
      tenantId: req.user.tenantId, 
      operation: operationName 
    });
    return req.user.tenantId;
  }

  // 3. Extract from request user organizationId (alternative field name)
  if (req?.user?.organizationId) {
    logger.debug('[TenantHelper] Using organizationId from req.user as tenant ID', { 
      tenantId: req.user.organizationId, 
      operation: operationName 
    });
    return req.user.organizationId;
  }

  // 4. Extract from request headers (for service-to-service calls)
  if (req?.headers?.['x-tenant-id']) {
    const headerTenantId = req.headers['x-tenant-id'];
    logger.debug('[TenantHelper] Using tenant ID from x-tenant-id header', { 
      tenantId: headerTenantId, 
      operation: operationName 
    });
    return headerTenantId;
  }

  // 5. Extract from request body (fallback for certain operations)
  if (req?.body?.tenantId) {
    logger.debug('[TenantHelper] Using tenant ID from request body', { 
      tenantId: req.body.tenantId, 
      operation: operationName 
    });
    return req.body.tenantId;
  }

  // If no tenant ID found, throw error
  const error = new Error(`Tenant ID required for ${operationName} but not found in request`);
  logger.error('[TenantHelper] Tenant ID not found', { 
    operation: operationName,
    hasReq: !!req,
    hasUser: !!req?.user,
    userKeys: req?.user ? Object.keys(req.user) : [],
    error: error.message
  });
  throw error;
}

/**
 * Extract tenant ID safely without throwing errors
 * @param {string|null} explicitTenantId - Explicitly provided tenant ID
 * @param {Object|null} req - Express request object
 * @returns {string|null} Tenant ID or null if not found
 */
function getTenantId(explicitTenantId = null, req = null) {
  try {
    return requireTenantId(explicitTenantId, req, 'getTenantId');
  } catch (error) {
    logger.debug('[TenantHelper] Could not extract tenant ID', { error: error.message });
    return null;
  }
}

/**
 * Validate that a tenant ID is a valid UUID format
 * @param {string} tenantId - Tenant ID to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    return false;
  }
  
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(tenantId);
}

module.exports = {
  requireTenantId,
  getTenantId,
  isValidTenantId
};
