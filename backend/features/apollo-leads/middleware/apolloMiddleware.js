/**
 * Apollo Leads Middleware
 * LAD Architecture: Request processing and authentication middleware
 * 
 * Middleware specific to Apollo leads feature operations.
 */

const { validateCompanySearchParams, validateEmployeeSearchParams, validateRevealParams } = require('../validators/apolloValidators');
const logger = require('../../../../core/utils/logger');

/**
 * Middleware to validate company search parameters
 */
function validateCompanySearchMiddleware(req, res, next) {
  const params = req.method === 'POST' ? req.body : req.query;
  const validation = validateCompanySearchParams(params);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid search parameters',
      details: validation.errors
    });
  }
  
  next();
}

/**
 * Middleware to validate employee search parameters
 */
function validateEmployeeSearchMiddleware(req, res, next) {
  const params = req.method === 'POST' ? req.body : req.query;
  const validation = validateEmployeeSearchParams(params);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid search parameters',
      details: validation.errors
    });
  }
  
  next();
}

/**
 * Middleware to validate reveal parameters
 */
function validateRevealMiddleware(req, res, next) {
  const params = req.method === 'POST' ? req.body : req.query;
  const validation = validateRevealParams(params);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid reveal parameters',
      details: validation.errors
    });
  }
  
  next();
}

/**
 * Middleware to check Apollo API configuration
 */
function checkApolloConfigMiddleware(req, res, next) {
  const apiKey = process.env.APOLLO_API_KEY;
  
  if (!apiKey) {
    logger.error('[Apollo Middleware] Apollo API key not configured');
    return res.status(503).json({
      success: false,
      error: 'Apollo service not configured'
    });
  }
  
  next();
}

/**
 * Middleware to add request timing
 */
function timingMiddleware(req, res, next) {
  req.startTime = Date.now();
  
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - req.startTime;
    logger.debug('[Apollo Middleware] Request completed', {
      method: req.method,
      path: req.path,
      duration: `${duration}ms`
    });
    originalSend.call(this, data);
  };
  
  next();
}

module.exports = {
  validateCompanySearchMiddleware,
  validateEmployeeSearchMiddleware,
  validateRevealMiddleware,
  checkApolloConfigMiddleware,
  timingMiddleware
};