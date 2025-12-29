/**
 * LinkedIn Integration Routes for Campaigns
 * Uses campaign's own LinkedIn integration services
 */

const express = require('express');
const { getSchema } = require('../../../core/utils/schemaHelper');
const router = express.Router();
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
const linkedInIntegrationService = require('../services/LinkedInIntegrationService');
const logger = require('../../../core/utils/logger');

// GET /api/campaigns/linkedin/status - Check LinkedIn connection status
router.get('/status', jwtAuth, async (req, res) => {
  logger.debug('[LinkedIn Routes] GET /status called');
  try {
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    logger.debug('[LinkedIn Routes] Fetching accounts', { tenantId });
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
    logger.info('[LinkedIn Routes] Found accounts', { count: accounts.length });
    if (accounts.length > 0) {
      logger.debug('[LinkedIn Routes] First account', {
        id: accounts[0].id,
        unipileAccountId: accounts[0].unipileAccountId,
        isActive: accounts[0].isActive,
        accountName: accounts[0].accountName
      });
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
    
    logger.debug('[LinkedIn Routes] Status response', {
      connected: hasConnected,
      status: primaryStatus,
      totalConnections: connections.length,
      connections: connections.map(c => ({ 
        id: c.id, 
        unipileAccountId: c.unipileAccountId, 
        status: c.status, 
        connected: c.connected,
        profileName: c.profileName
      }))
    });
    
    logger.debug('[LinkedIn Routes] Raw accounts from query', {
      accounts: accounts.map(a => ({
        id: a.id,
        unipileAccountId: a.unipileAccountId,
        isActive: a.isActive,
        accountName: a.accountName
      }))
    });
    
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
    logger.error('[LinkedIn] Status check error', { error: error.message, stack: error.stack });
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
  logger.debug('[LinkedIn Routes] POST /connect called', { body: req.body });
  try {
    const { method, email, password, redirectUri, li_at, li_a, user_agent } = req.body;
    
    // If method is provided (credentials or cookies), use credentials-based connection
    if (method && (method === 'credentials' || method === 'cookies')) {
      const LinkedInAuthController = require('../controllers/LinkedInAuthController');
      return LinkedInAuthController.connect(req, res);
    }
    
    // Otherwise, use OAuth flow (backward compatibility)
    const userId = req.user.userId;
    const result = await linkedInIntegrationService.startLinkedInConnection(userId, redirectUri);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('[LinkedIn] Connect error', { error: error.message, stack: error.stack });
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
    logger.error('[LinkedIn] Callback error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/disconnect - Disconnect LinkedIn account
router.post('/disconnect', jwtAuth, async (req, res) => {
  try {
    logger.debug('[LinkedIn Routes] POST /disconnect called', { body: req.body, query: req.query, url: req.url, originalUrl: req.originalUrl });
    
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    
    // Support multiple parameter names (like pluto_campaigns)
    // UI might send: connection_id (database id), unipileAccountId, or accountId
    // Frontend sends connection_id as query parameter: ?connection_id=xxx
    const connectionId = req.body.connection_id || req.query.connection_id || req.body.connectionId || req.query.connectionId;
    const unipileAccountId = req.body.unipileAccountId || req.query.unipileAccountId || req.body.unipile_account_id || req.headers['x-unipile-account-id'];
    const accountId = req.body.accountId || req.query.accountId || req.headers['x-account-id'];
    
    logger.debug('[LinkedIn Routes] Disconnect parameters', {
      connectionId,
      unipileAccountId,
      accountId,
      tenantId
    });
    
    // If connection_id is provided (database UUID), look up the unipile_account_id
    let targetUnipileAccountId = unipileAccountId || accountId;
    
    if (connectionId && !targetUnipileAccountId) {
      logger.debug('[LinkedIn Routes] connection_id provided, looking up unipile_account_id', { connectionId });
      
      try {
        const { pool } = require('../utils/dbConnection');
        
        const schema = getSchema(req);
        // Check if connection_id is a UUID (from ${schema}.linkedin_accounts) or integer
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId);
        
        if (isUUID) {
          // UUID - query ${schema}.linkedin_accounts table (TDD schema)
          logger.debug('[LinkedIn Routes] connection_id is UUID, querying linkedin_accounts table');
          const lookupQuery = `
            SELECT unipile_account_id
            FROM ${schema}.linkedin_accounts
            WHERE id = $1
              AND tenant_id = $2
              AND unipile_account_id IS NOT NULL
              AND unipile_account_id != ''
            LIMIT 1
          `;
          const lookupResult = await pool.query(lookupQuery, [connectionId, tenantId]);
          
          if (lookupResult.rows.length > 0) {
            targetUnipileAccountId = lookupResult.rows[0].unipile_account_id;
            logger.info('[LinkedIn Routes] Found unipile_account_id in linkedin_accounts', { unipileAccountId: targetUnipileAccountId, connectionId });
          } else {
            logger.warn('[LinkedIn Routes] No account found with UUID', { connectionId });
          }
        } else {
          // Integer ID - try old schema (fallback)
          logger.debug('[LinkedIn Routes] connection_id is integer, querying old schema');
          const lookupQuery = `
            SELECT credentials->>'unipile_account_id' as unipile_account_id
            FROM voice_agent.user_integrations_voiceagent
            WHERE id = $1
              AND provider = 'linkedin'
              AND credentials->>'unipile_account_id' IS NOT NULL
              AND credentials->>'unipile_account_id' != ''
            LIMIT 1
          `;
          const lookupResult = await pool.query(lookupQuery, [connectionId]);
          
          if (lookupResult.rows.length > 0) {
            targetUnipileAccountId = lookupResult.rows[0].unipile_account_id;
            logger.info('[LinkedIn Routes] Found unipile_account_id in old schema', { unipileAccountId: targetUnipileAccountId, connectionId });
          } else {
            logger.warn('[LinkedIn Routes] No account found with id in old schema', { connectionId });
          }
        }
      } catch (lookupError) {
        logger.error('[LinkedIn Routes] Error looking up connection_id', { error: lookupError.message, stack: lookupError.stack });
        // Continue - we'll try to use connectionId as unipileAccountId
      }
    }
    
    // If still no unipileAccountId found, try to use connectionId directly (might be unipileAccountId)
    if (!targetUnipileAccountId) {
      targetUnipileAccountId = connectionId;
    }
    
    // If no account identifier provided, try to get the first account for the user
    if (!targetUnipileAccountId) {
      logger.debug('[LinkedIn Routes] No account identifier provided, fetching first account for tenant');
      try {
        const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
        if (accounts && accounts.length > 0) {
          // Use the first account's unipile_account_id
          targetUnipileAccountId = accounts[0].unipile_account_id || accounts[0].id;
          logger.info('[LinkedIn Routes] Using first account', { unipileAccountId: targetUnipileAccountId });
        } else {
          return res.status(404).json({
            success: false,
            error: 'No LinkedIn accounts found to disconnect'
          });
        }
      } catch (fetchError) {
        logger.error('[LinkedIn Routes] Error fetching accounts', { error: fetchError.message, stack: fetchError.stack });
        return res.status(400).json({
          success: false,
          error: 'unipileAccountId, accountId, or connection_id is required. Could not fetch accounts automatically.'
        });
      }
    }
    
    logger.info('[LinkedIn Routes] Disconnecting account', { unipileAccountId: targetUnipileAccountId });
    await linkedInIntegrationService.disconnectAccount(tenantId, targetUnipileAccountId);
    
    res.json({
      success: true,
      message: 'LinkedIn account disconnected successfully'
    });
  } catch (error) {
    logger.error('[LinkedIn] Disconnect error', { error: error.message, stack: error.stack });
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
    logger.error('[LinkedIn] List accounts error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
