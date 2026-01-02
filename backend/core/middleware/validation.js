/**
 * Request Validation Middleware
 * Provides comprehensive input validation for all API endpoints
 */

const logger = require('../utils/logger');

/**
 * Validation types
 */
const ValidationTypes = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  EMAIL: 'email',
  UUID: 'uuid',
  ARRAY: 'array',
  OBJECT: 'object',
  DATE: 'date',
  ENUM: 'enum'
};

/**
 * Validate a single field
 */
function validateField(value, rules, fieldName) {
  const errors = [];

  if (rules.required && (value === undefined || value === null || value === '')) {
    errors.push(`${fieldName} is required`);
    return errors;
  }

  if (value === undefined || value === null) {
    return errors;
  }

  if (rules.type === ValidationTypes.STRING) {
    if (typeof value !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      if (rules.minLength && value.length < rules.minLength) {
        errors.push(`${fieldName} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${fieldName} must be at most ${rules.maxLength} characters`);
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${fieldName} format is invalid`);
      }
    }
  }

  if (rules.type === ValidationTypes.NUMBER) {
    const num = Number(value);
    if (isNaN(num)) {
      errors.push(`${fieldName} must be a number`);
    } else {
      if (rules.min !== undefined && num < rules.min) {
        errors.push(`${fieldName} must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && num > rules.max) {
        errors.push(`${fieldName} must be at most ${rules.max}`);
      }
      if (rules.integer && !Number.isInteger(num)) {
        errors.push(`${fieldName} must be an integer`);
      }
    }
  }

  if (rules.type === ValidationTypes.BOOLEAN) {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      errors.push(`${fieldName} must be a boolean`);
    }
  }

  if (rules.type === ValidationTypes.EMAIL) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) {
      errors.push(`${fieldName} must be a valid email address`);
    }
  }

  if (rules.type === ValidationTypes.UUID) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(value)) {
      errors.push(`${fieldName} must be a valid UUID`);
    }
  }

  if (rules.type === ValidationTypes.ARRAY) {
    if (!Array.isArray(value)) {
      errors.push(`${fieldName} must be an array`);
    } else {
      if (rules.minItems && value.length < rules.minItems) {
        errors.push(`${fieldName} must contain at least ${rules.minItems} items`);
      }
      if (rules.maxItems && value.length > rules.maxItems) {
        errors.push(`${fieldName} must contain at most ${rules.maxItems} items`);
      }
      if (rules.itemType) {
        value.forEach((item, index) => {
          const itemErrors = validateField(item, { type: rules.itemType }, `${fieldName}[${index}]`);
          errors.push(...itemErrors);
        });
      }
    }
  }

  if (rules.type === ValidationTypes.OBJECT) {
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      errors.push(`${fieldName} must be an object`);
    }
  }

  if (rules.type === ValidationTypes.DATE) {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      errors.push(`${fieldName} must be a valid date`);
    }
  }

  if (rules.type === ValidationTypes.ENUM) {
    if (!rules.values || !rules.values.includes(value)) {
      errors.push(`${fieldName} must be one of: ${rules.values.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Create validation middleware
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const errors = [];
    const data = { ...req.body, ...req.query, ...req.params };

    for (const [fieldName, rules] of Object.entries(schema)) {
      const value = data[fieldName];
      const fieldErrors = validateField(value, rules, fieldName);
      errors.push(...fieldErrors);
    }

    if (errors.length > 0) {
      logger.warn('Validation failed', { errors, path: req.path, method: req.method });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    next();
  };
}

/**
 * Sanitize input to prevent XSS and injection attacks
 */
function sanitizeInput(req, res, next) {
  const sanitize = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(sanitize);
      }
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitize(val);
      }
      return sanitized;
    }
    return value;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
}

/**
 * Validate tenant context
 */
function validateTenantContext(req, res, next) {
  const tenantId = req.user?.organizationId || req.headers['x-tenant-id'];

  if (!tenantId) {
    logger.warn('Missing tenant context', { path: req.path, method: req.method });
    return res.status(400).json({
      success: false,
      error: 'Tenant context is required'
    });
  }

  req.tenantId = tenantId;
  next();
}

/**
 * Validate pagination parameters
 */
function validatePagination(req, res, next) {
  const { page, limit, offset } = req.query;

  if (page !== undefined) {
    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'Page must be a positive integer'
      });
    }
    req.query.page = pageNum;
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }
    req.query.limit = limitNum;
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        success: false,
        error: 'Offset must be a non-negative integer'
      });
    }
    req.query.offset = offsetNum;
  }

  next();
}

/**
 * Common validation schemas for campaigns
 */
const CommonSchemas = {
  campaignId: {
    type: ValidationTypes.STRING,
    required: true,
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  },
  campaignStatus: {
    type: ValidationTypes.ENUM,
    values: ['draft', 'active', 'paused', 'completed', 'cancelled']
  },
  pagination: {
    page: { type: ValidationTypes.NUMBER, min: 1 },
    limit: { type: ValidationTypes.NUMBER, min: 1, max: 100 },
    offset: { type: ValidationTypes.NUMBER, min: 0 }
  }
};

module.exports = {
  ValidationTypes,
  validateRequest,
  validateField,
  sanitizeInput,
  validateTenantContext,
  validatePagination,
  CommonSchemas
};
