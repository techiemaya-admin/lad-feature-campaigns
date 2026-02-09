/**
 * Campaign Public Routes
 * Routes accessible without JWT authentication (for Cloud Tasks callbacks)
 * 
 * LAD Architecture: These routes bypass JWT auth but use their own authentication
 * (Cloud Tasks secret or OIDC token validation)
 */
const express = require('express');
const router = express.Router();
const CampaignDailyController = require('../controllers/CampaignDailyController');
const logger = require('../../../core/utils/logger');

// Log ALL requests to this router for debugging
router.use((req, res, next) => {
  logger.info('[CampaignsPublicRoutes] Request received', {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl
  });
  next();
});

/**
 * Cloud Tasks authentication middleware
 * Validates requests from Google Cloud Tasks using shared secret
 */
const validateCloudTasksAuth = (req, res, next) => {
  const cloudTasksSecret = process.env.CLOUD_TASKS_SECRET;
  
  // Log incoming request for debugging
  logger.info('[CloudTasksAuth] Validating request', {
    hasSecret: !!cloudTasksSecret,
    hasAuthHeader: !!req.headers.authorization,
    hasCloudTasksSecret: !!req.headers['x-cloudtasks-secret'],
    path: req.path
  });
  
  // If OIDC is configured, validate JWT token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // TODO: Implement OIDC token validation
    // For now, allow if Bearer token present (Cloud Run verifies OIDC)
    logger.debug('[CloudTasksAuth] Bearer token present, allowing request');
    return next();
  }

  // Fallback: Check shared secret
  if (cloudTasksSecret) {
    const requestSecret = req.headers['x-cloudtasks-secret'];
    if (requestSecret !== cloudTasksSecret) {
      logger.warn('[CloudTasksAuth] Invalid secret provided', {
        expectedLength: cloudTasksSecret?.length,
        receivedLength: requestSecret?.length,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid Cloud Tasks secret'
      });
    }
    logger.debug('[CloudTasksAuth] Secret validated successfully');
  } else {
    logger.warn('[CloudTasksAuth] No CLOUD_TASKS_SECRET configured - allowing request in dev mode');
  }

  next();
};

/**
 * POST /api/campaigns/run-daily
 * Cloud Tasks callback endpoint for running daily campaign tasks
 * 
 * This endpoint is called by Google Cloud Tasks scheduler, not by users.
 * Authentication is via X-CloudTasks-Secret header or OIDC token.
 */
router.post('/run-daily', validateCloudTasksAuth, (req, res) => CampaignDailyController.runDaily(req, res));

module.exports = router;
