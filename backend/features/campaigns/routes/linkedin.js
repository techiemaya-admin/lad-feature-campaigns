/**
 * LinkedIn Integration Routes for Campaigns
 * Uses campaign's own LinkedIn integration services
 */
const express = require('express');
const router = express.Router();
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
const { getSchema } = require('../../../core/utils/schemaHelper');
const linkedInIntegrationService = require('../services/LinkedInIntegrationService');
const { pollingScheduler } = require('../services/pollingScheduler');
// GET /api/campaigns/linkedin/status - Check LinkedIn connection status
router.get('/status', jwtAuth, async (req, res) => {
  try {
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
    if (accounts.length > 0) {
    }
    // Build connections array for frontend (matching pluto_campaigns format)
    // Frontend expects: { connections: [...], connected: boolean, status: string }
    // Each connection needs: id (database ID for disconnect), connected, status, profileName, etc.
    const connections = (accounts || []).map(account => {
      // Account is connected if isActive is true (from TDD schema) or status is 'connected'
      const isConnected = account.isActive === true || account.status === 'connected';
      const unipileAccountId = account.unipileAccountId || account.unipile_account_id;
      return {
        id: account.id, // Database ID - frontend uses this as connection_id for disconnect
        connected: isConnected,
        status: isConnected ? 'connected' : 'disconnected',
        profileName: account.accountName || account.profileName || 'LinkedIn User',
        profileUrl: account.profileUrl,
        email: account.email,
        connectedAt: account.connectedAt,
        connectionMethod: 'credentials', // or 'oauth' if we track this
        unipileAccountId: unipileAccountId, // For reference - use camelCase from query service
        unipileAccount: {
          id: unipileAccountId,
          state: isConnected ? 'connected' : 'disconnected',
          lastChecked: new Date().toISOString()
        }
      };
    });
    const hasConnected = connections.some(conn => conn.connected);
    const primaryStatus = connections.length > 0 ? connections[0].status : 'disconnected';
    
    // Return format matching frontend expectations (like pluto_campaigns)
    res.json({
      connected: hasConnected,
      status: primaryStatus,
      connections: connections,
      totalConnections: connections.length,
      // Also include accounts for backward compatibility
      accounts: accounts || [],
      success: true
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      status: 'error',
      error: error.message,
      connections: []
    });
  }
});
// POST /api/campaigns/linkedin/connect - Connect LinkedIn account (OAuth or credentials)
router.post('/connect', jwtAuth, async (req, res) => {
  const logger = require('../../../core/utils/logger');
  try {
    const { method, email, password, redirectUri, li_at, li_a, user_agent } = req.body;
    
    logger.info('[LinkedIn Connect] Request received', { 
      method, 
      hasEmail: !!email,
      hasPassword: !!password,
      hasLiAt: !!li_at,
      hasRedirectUri: !!redirectUri,
      userId: req.user?.userId?.substring(0, 8)
    });
    
    // If method is provided (credentials or cookies), use credentials-based connection
    if (method && (method === 'credentials' || method === 'cookies')) {
      logger.info('[LinkedIn Connect] Using credentials/cookies method', { method });
      const LinkedInAuthController = require('../controllers/LinkedInAuthController');
      return LinkedInAuthController.connect(req, res);
    }
    
    // Otherwise, use OAuth flow (backward compatibility)
    logger.info('[LinkedIn Connect] Using OAuth flow');
    const userId = req.user.userId;
    const result = await linkedInIntegrationService.startLinkedInConnection(userId, redirectUri);
    
    logger.info('[LinkedIn Connect] OAuth URL generated', { hasUrl: !!result });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('[LinkedIn Connect] Error', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// POST /api/campaigns/linkedin/verify-otp - Verify OTP for checkpoint
router.post('/verify-otp', jwtAuth, async (req, res) => {
  const LinkedInCheckpointController = require('../controllers/LinkedInCheckpointController');
  return LinkedInCheckpointController.verifyOTP(req, res);
});
// POST /api/campaigns/linkedin/solve-checkpoint - Solve checkpoint (Yes/No validation)
router.post('/solve-checkpoint', jwtAuth, async (req, res) => {
  const LinkedInCheckpointController = require('../controllers/LinkedInCheckpointController');
  return LinkedInCheckpointController.solveCheckpoint(req, res);
});
// GET /api/campaigns/linkedin/checkpoint-status - Get checkpoint status (for polling)
router.get('/checkpoint-status', jwtAuth, async (req, res) => {
  const LinkedInCheckpointController = require('../controllers/LinkedInCheckpointController');
  return LinkedInCheckpointController.getCheckpointStatus(req, res);
});
// GET /api/campaigns/linkedin/callback - OAuth callback handler
router.get('/callback', jwtAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code, redirectUri } = req.query;
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }
    const result = await linkedInIntegrationService.handleLinkedInCallback(userId, code, redirectUri);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// POST /api/campaigns/linkedin/disconnect - Disconnect LinkedIn account
// POST /api/campaigns/linkedin/disconnect - Disconnect LinkedIn account
router.post('/disconnect', jwtAuth, async (req, res) => {
  const logger = require('../../../core/utils/logger');
  try {
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    
    logger.info('[LinkedIn Disconnect] Request received', {
      tenantId: tenantId?.substring(0, 8),
      body: req.body,
      query: req.query
    });
    
    // Support multiple parameter names (like pluto_campaigns)
    // UI might send: connection_id (database id), unipileAccountId, or accountId
    // Frontend sends accountId as the database UUID
    const connectionId = req.body.connection_id || req.query.connection_id || req.body.connectionId || req.query.connectionId;
    const accountId = req.body.accountId || req.query.accountId || req.headers['x-account-id'];
    const unipileAccountId = req.body.unipileAccountId || req.query.unipileAccountId || req.body.unipile_account_id || req.headers['x-unipile-account-id'];
    
    // accountId or connectionId are database IDs - need to look up provider_account_id
    const databaseId = accountId || connectionId;
    let targetUnipileAccountId = unipileAccountId;
    
    if (databaseId && !targetUnipileAccountId) {
      try {
        const { pool } = require('../../../shared/database/connection');
        const schema = getSchema(req);
        // Check if databaseId is a UUID (from ${schema}.social_linkedin_accounts) or integer
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId);
        if (isUUID) {
          // UUID - query ${schema}.social_linkedin_accounts table (production schema)
          const lookupQuery = `
            SELECT provider_account_id as unipile_account_id
            FROM ${schema}.social_linkedin_accounts
            WHERE id = $1
              AND tenant_id = $2
              AND provider_account_id IS NOT NULL
              AND provider_account_id != ''
            LIMIT 1
          `;
          const lookupResult = await pool.query(lookupQuery, [databaseId, tenantId]);
          if (lookupResult.rows.length > 0) {
            targetUnipileAccountId = lookupResult.rows[0].unipile_account_id;
            logger.info('[LinkedIn Disconnect] Found unipileAccountId from database', {
              databaseId,
              unipileAccountId: targetUnipileAccountId
            });
          } else {
            logger.warn('[LinkedIn Disconnect] No account found for databaseId', { databaseId, tenantId });
          }
        } else {
          // Integer ID - try old schema (fallback)
          const lookupQuery = `
            SELECT credentials->>'unipile_account_id' as unipile_account_id
            FROM ${schema}.user_integrations_voiceagent
            WHERE id = $1
              AND provider = 'linkedin'
              AND credentials->>'unipile_account_id' IS NOT NULL
              AND credentials->>'unipile_account_id' != ''
            LIMIT 1
          `;
          const lookupResult = await pool.query(lookupQuery, [databaseId]);
          if (lookupResult.rows.length > 0) {
            targetUnipileAccountId = lookupResult.rows[0].unipile_account_id;
            logger.info('[LinkedIn Disconnect] Found unipileAccountId from old schema', {
              databaseId,
              unipileAccountId: targetUnipileAccountId
            });
          } else {
            logger.warn('[LinkedIn Disconnect] No account found in old schema', { databaseId });
          }
        }
      } catch (lookupError) {
        logger.error('[LinkedIn Disconnect] Error looking up account', { 
          error: lookupError.message,
          databaseId 
        });
        // Continue - we'll try to use databaseId as unipileAccountId
      }
    }
    // If still no unipileAccountId found, try to use databaseId directly (might be unipileAccountId)
    if (!targetUnipileAccountId) {
      targetUnipileAccountId = databaseId;
    }
    // If no account identifier provided, try to get the first account for the user
    if (!targetUnipileAccountId) {
      try {
        const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
        if (accounts && accounts.length > 0) {
          // Use the first account's unipile_account_id
          targetUnipileAccountId = accounts[0].unipile_account_id || accounts[0].id;
        } else {
          return res.status(404).json({
            success: false,
            error: 'No LinkedIn accounts found to disconnect'
          });
        }
      } catch (fetchError) {
        return res.status(400).json({
          success: false,
          error: 'unipileAccountId, accountId, or connection_id is required. Could not fetch accounts automatically.'
        });
      }
    }
    
    logger.info('[LinkedIn Disconnect] Calling disconnect service', {
      tenantId: tenantId?.substring(0, 8),
      targetUnipileAccountId: targetUnipileAccountId?.substring(0, 8)
    });
    
    await linkedInIntegrationService.disconnectAccount(tenantId, targetUnipileAccountId);
    
    logger.info('[LinkedIn Disconnect] Disconnect successful');
    
    res.json({
      success: true,
      message: 'LinkedIn account disconnected successfully'
    });
  } catch (error) {
    logger.error('[LinkedIn Disconnect] Error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// GET /api/campaigns/linkedin/accounts - List all LinkedIn accounts for user
router.get('/accounts', jwtAuth, async (req, res) => {
  try {
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
    res.json({
      success: true,
      accounts: accounts || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/campaigns/linkedin/polling/status - Get polling scheduler status
router.get('/polling/status', jwtAuth, async (req, res) => {
  try {
    const status = pollingScheduler.getStatus();
    res.json({
      success: true,
      polling: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/polling/trigger - Manually trigger polling (for testing)
router.post('/polling/trigger', jwtAuth, async (req, res) => {
  try {
    const result = await pollingScheduler.triggerManualPoll();
    res.json({
      success: result.success,
      message: result.message || result.error,
      result: result.result || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/campaigns/linkedin/polling/status - Get polling scheduler status
router.get('/polling/status', jwtAuth, async (req, res) => {
  try {
    const status = pollingScheduler.getStatus();
    res.json({
      success: true,
      polling: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/polling/trigger - Manually trigger polling (for testing)
router.post('/polling/trigger', jwtAuth, async (req, res) => {
  try {
    const result = await pollingScheduler.triggerManualPoll();
    res.json({
      success: result.success,
      message: result.message || result.error
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== WEBHOOK ROUTES ====================
const LinkedInWebhookController = require('../controllers/LinkedInWebhookController');

// NOTE: Webhook receiver (/webhooks/account-status) is in public.routes.js (no JWT required)
// These routes are for webhook MANAGEMENT (require JWT auth)

// POST /api/campaigns/linkedin/webhooks/register-account-status - Register account status webhook
router.post('/webhooks/register-account-status', jwtAuth, LinkedInWebhookController.registerAccountStatusWebhook);

// GET /api/campaigns/linkedin/webhooks - List all webhooks
router.get('/webhooks', jwtAuth, LinkedInWebhookController.listWebhooks);

// POST /api/campaigns/linkedin/webhooks/register - Register general webhook
router.post('/webhooks/register', jwtAuth, LinkedInWebhookController.registerWebhook);

module.exports = router;
