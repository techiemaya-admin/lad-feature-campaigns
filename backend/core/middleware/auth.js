/**
 * Core Authentication Middleware
 * 
 * PURPOSE:
 * Provides JWT token validation and user context extraction for all API routes.
 * This middleware ensures that protected endpoints verify user identity and
 * extract essential information needed for feature access control.
 * 
 * AUTHENTICATION FLOW:
 * 1. Extract JWT token from Authorization header (Bearer format)
 * 2. Verify token signature and expiration
 * 3. Decode user information (id, email, role, clientId)
 * 4. Attach user context to request object
 * 5. Allow request to proceed to next middleware/route
 * 
 * USER CONTEXT PROVIDED:
 * - req.user.id: User identifier
 * - req.user.email: User email address
 * - req.user.role: User role (admin, user, viewer)
 * - req.user.clientId: Organization/client identifier (crucial for feature flags)
 * 
 * SECURITY FEATURES:
 * - Token signature verification prevents tampering
 * - Expiration checking prevents replay attacks
 * - Public endpoints bypass authentication (login, register, health)
 * - Proper error responses for invalid/missing tokens
 * 
 * INTEGRATION:
 * - ClientId is used by FeatureFlagService for feature access control
 * - User context flows to all downstream middleware and routes
 * - Supports multi-tenant architecture with client isolation
 * 
 * ERROR HANDLING:
 * - 401 Unauthorized: Missing or invalid token
 * - 403 Forbidden: Token valid but insufficient permissions
 * - Graceful handling of malformed tokens
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authenticateToken = (req, res, next) => {
  // Skip auth for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Skip auth for public endpoints
  const publicPaths = ['/api/auth/login', '/api/auth/register', '/health', '/api/stripe/webhook'];
  // Also skip auth for feature health endpoints
  if (publicPaths.includes(req.path) || req.path.includes('/health')) {
    logger.debug(`[Auth] Skipping auth for health endpoint: ${req.path}`);
    return next();
  }

  // Skip auth for Cloud Tasks endpoints (they have their own auth via headers)
  if (req.path.includes('/execute-followup') || req.path.includes('/run-daily')) {
    logger.debug(`[Auth] Skipping auth for Cloud Tasks endpoint: ${req.path}`);
    return next();
  }

  // Skip auth for service-to-service calls with x-tenant-id header
  // These are internal API calls from campaign processor, scheduled tasks, etc.
  const tenantIdHeader = req.headers['x-tenant-id'];
  const fullPath = req.originalUrl || req.path;
  
  // Log all requests to apollo-leads endpoints for debugging
  if (fullPath.includes('/apollo-leads/')) {
    logger.info('[Auth] Apollo-leads request detected', {
      path: req.path,
      originalUrl: req.originalUrl,
      fullPath: fullPath,
      method: req.method,
      hasTenantHeader: !!tenantIdHeader,
      tenantId: tenantIdHeader,
      hasAuthHeader: !!req.headers['authorization']
    });
  }
  
  if (tenantIdHeader && (
    fullPath.includes('/api/apollo-leads/search-employees-from-db') ||
    fullPath.includes('/api/apollo-leads/search-employees') ||
    fullPath.includes('/apollo-leads/search-employees-from-db') ||
    fullPath.includes('/apollo-leads/search-employees')
  )) {
    logger.info('[Auth] Bypassing auth for service-to-service call', {
      path: req.path,
      originalUrl: req.originalUrl,
      fullPath: fullPath,
      tenantId: tenantIdHeader
    });
    // Set tenant context for downstream processing
    req.user = { 
      tenantId: tenantIdHeader,
      serviceCall: true 
    };
    return next();
  }

  // Try to get token from Authorization header first, then from cookies, then from query params
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  // If no Authorization header, try to get token from cookies
  if (!token && req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  // For SSE endpoints (EventSource can't set headers), check query parameter
  if (!token && req.query && req.query.token) {
    token = req.query.token;
    logger.debug('[Auth] Using token from query parameter for SSE');
  }

  if (!token) {
    // Only log at debug level - missing tokens are common for unauthenticated requests
    logger.debug(`Auth failed - No token for ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    logger.debug(`Auth success for ${req.method} ${req.path}`, { 
      userId: decoded.userId, 
      email: decoded.email 
    });
    next();
  } catch (error) {
    logger.warn(`Auth failed - Invalid token for ${req.method} ${req.path}`, {
      error: error.message,
      tokenPrefix: token ? token.substring(0, 20) : 'none',
      secretConfigured: !!process.env.JWT_SECRET
    });
    
    // Provide more helpful error message if JWT_SECRET might not be configured
    let details = error.message;
    if (!process.env.JWT_SECRET) {
      details = 'JWT_SECRET not configured. Check Google Cloud Secret Manager and Cloud Run environment variables.';
    }
    
    return res.status(403).json({
      success: false,
      error: 'Invalid token',
      details: details
    });
  }
};

/**
 * SSE-specific authentication middleware
 * 
 * Unlike regular auth, this sets SSE headers first, then sends error events
 * instead of JSON responses to prevent MIME type errors in EventSource
 */
const authenticateSSE = (req, res, next) => {
  // Skip auth for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Set SSE headers first to prevent MIME type errors
  const origin = req.headers.origin || '*';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Try to get token from query params (EventSource limitation)
  let token = req.query && req.query.token;
  
  // Fallback to Authorization header
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }
  
  // Fallback to cookies
  if (!token && req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) {
    logger.debug(`[SSE Auth] No token for ${req.method} ${req.path}`);
    // Send SSE error event instead of JSON
    res.write(`data: ${JSON.stringify({
      type: 'ERROR',
      error: 'Authentication required',
      message: 'Access token required for SSE connection'
    })}\n\n`);
    return res.end();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    req.user = decoded;
    logger.debug(`[SSE Auth] Success for ${req.method} ${req.path}`, { 
      userId: decoded.userId, 
      email: decoded.email 
    });
    next();
  } catch (error) {
    logger.warn(`[SSE Auth] Invalid token for ${req.method} ${req.path}`, {
      error: error.message
    });
    // Send SSE error event instead of JSON
    res.write(`data: ${JSON.stringify({
      type: 'ERROR',
      error: 'Invalid token',
      message: error.message
    })}\n\n`);
    return res.end();
  }
};

module.exports = { authenticateToken, authenticateSSE };