/**
 * LinkedIn Integration Routes for Campaigns
 * Uses campaign's own LinkedIn integration services
 */

const express = require('express');
const { getSchema } = require('../../../core/utils/schemaHelper');
const router = express.Router();
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
const linkedInIntegrationService = require('../services/LinkedInIntegrationService');

// GET /api/campaigns/linkedin/status - Check LinkedIn connection status
router.get('/status', jwtAuth, async (req, res) => {
  console.log('[LinkedIn Routes] GET /status called');
  try {
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    console.log('[LinkedIn Routes] Fetching accounts for tenantId:', tenantId);
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
    console.log('[LinkedIn Routes] Found accounts:', accounts.length, 'accounts');
    if (accounts.length > 0) {
      console.log('[LinkedIn Routes] First account keys:', Object.keys(accounts[0]));
      console.log('[LinkedIn Routes] First account data:', JSON.stringify({
        id: accounts[0].id,
        unipileAccountId: accounts[0].unipileAccountId,
        isActive: accounts[0].isActive,
        accountName: accounts[0].accountName
      }, null, 2));
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
    
    console.log('[LinkedIn Routes] Status response:', {
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
    
    // Debug: Log raw accounts for troubleshooting
    console.log('[LinkedIn Routes] Raw accounts from query:', JSON.stringify(accounts.map(a => ({
      id: a.id,
      unipileAccountId: a.unipileAccountId,
      isActive: a.isActive,
      accountName: a.accountName
    })), null, 2));
    
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
    console.error('[LinkedIn] Status check error:', error);
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
  console.log('[LinkedIn Routes] POST /connect called');
  console.log('[LinkedIn Routes] Request body:', JSON.stringify(req.body, null, 2));
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
    console.error('[LinkedIn] Connect error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/verify-otp - Verify OTP for checkpoint
router.post('/verify-otp', jwtAuth, async (req, res) => {
  const LinkedInAuthController = require('../controllers/LinkedInAuthController');
  return LinkedInAuthController.verifyOTP(req, res);
});

// POST /api/campaigns/linkedin/solve-checkpoint - Solve checkpoint (Yes/No validation)
router.post('/solve-checkpoint', jwtAuth, async (req, res) => {
  const LinkedInAuthController = require('../controllers/LinkedInAuthController');
  return LinkedInAuthController.solveCheckpoint(req, res);
});

// GET /api/campaigns/linkedin/checkpoint-status - Get checkpoint status (for polling)
router.get('/checkpoint-status', jwtAuth, async (req, res) => {
  const LinkedInAuthController = require('../controllers/LinkedInAuthController');
  return LinkedInAuthController.getCheckpointStatus(req, res);
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
    console.error('[LinkedIn] Callback error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/disconnect - Disconnect LinkedIn account
router.post('/disconnect', jwtAuth, async (req, res) => {
  try {
    console.log('[LinkedIn Routes] POST /disconnect called');
    console.log('[LinkedIn Routes] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[LinkedIn Routes] Request query:', JSON.stringify(req.query, null, 2));
    console.log('[LinkedIn Routes] Request URL:', req.url);
    console.log('[LinkedIn Routes] Request originalUrl:', req.originalUrl);
    
    // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
    const tenantId = req.user.tenantId || req.user.userId;
    
    // Support multiple parameter names (like pluto_campaigns)
    // UI might send: connection_id (database id), unipileAccountId, or accountId
    // Frontend sends connection_id as query parameter: ?connection_id=xxx
    const connectionId = req.body.connection_id || req.query.connection_id || req.body.connectionId || req.query.connectionId;
    const unipileAccountId = req.body.unipileAccountId || req.query.unipileAccountId || req.body.unipile_account_id || req.headers['x-unipile-account-id'];
    const accountId = req.body.accountId || req.query.accountId || req.headers['x-account-id'];
    
    console.log('[LinkedIn Routes] Disconnect parameters (raw):', {
      'req.body.connection_id': req.body.connection_id,
      'req.query.connection_id': req.query.connection_id,
      'req.body.connectionId': req.body.connectionId,
      'req.query.connectionId': req.query.connectionId,
      connectionId,
      unipileAccountId,
      accountId,
      tenantId
    });
    
    // If connection_id is provided (database UUID), look up the unipile_account_id
    let targetUnipileAccountId = unipileAccountId || accountId;
    
    if (connectionId && !targetUnipileAccountId) {
      console.log('[LinkedIn Routes] connection_id provided, looking up unipile_account_id from database ID:', connectionId);
      
      try {
        const { pool } = require('../utils/dbConnection');
        
        const schema = getSchema(req);
        // Check if connection_id is a UUID (from ${schema}.linkedin_accounts) or integer
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId);
        
        if (isUUID) {
          // UUID - query ${schema}.linkedin_accounts table (TDD schema)
          console.log('[LinkedIn Routes] connection_id is UUID, querying ${schema}.linkedin_accounts table...');
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
            console.log('[LinkedIn Routes] ✅ Found unipile_account_id in ${schema}.linkedin_accounts:', targetUnipileAccountId, 'for UUID:', connectionId);
          } else {
            console.warn('[LinkedIn Routes] ⚠️ No account found with UUID:', connectionId, 'in ${schema}.linkedin_accounts');
          }
        } else {
          // Integer ID - try old schema (fallback)
          console.log('[LinkedIn Routes] connection_id is integer, querying old schema...');
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
            console.log('[LinkedIn Routes] ✅ Found unipile_account_id in old schema:', targetUnipileAccountId, 'for id:', connectionId);
          } else {
            console.warn('[LinkedIn Routes] ⚠️ No account found with id:', connectionId, 'in old schema');
          }
        }
      } catch (lookupError) {
        console.error('[LinkedIn Routes] Error looking up connection_id:', lookupError.message);
        // Continue - we'll try to use connectionId as unipileAccountId
      }
    }
    
    // If still no unipileAccountId found, try to use connectionId directly (might be unipileAccountId)
    if (!targetUnipileAccountId) {
      targetUnipileAccountId = connectionId;
    }
    
    // If no account identifier provided, try to get the first account for the user
    if (!targetUnipileAccountId) {
      console.log('[LinkedIn Routes] No account identifier provided, fetching first account for tenant...');
      try {
        const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(tenantId);
        if (accounts && accounts.length > 0) {
          // Use the first account's unipile_account_id
          targetUnipileAccountId = accounts[0].unipile_account_id || accounts[0].id;
          console.log('[LinkedIn Routes] Using first account:', targetUnipileAccountId);
        } else {
          return res.status(404).json({
            success: false,
            error: 'No LinkedIn accounts found to disconnect'
          });
        }
      } catch (fetchError) {
        console.error('[LinkedIn Routes] Error fetching accounts:', fetchError.message);
        return res.status(400).json({
          success: false,
          error: 'unipileAccountId, accountId, or connection_id is required. Could not fetch accounts automatically.'
        });
      }
    }
    
    console.log('[LinkedIn Routes] Disconnecting account with unipile_account_id:', targetUnipileAccountId);
    await linkedInIntegrationService.disconnectAccount(tenantId, targetUnipileAccountId);
    
    res.json({
      success: true,
      message: 'LinkedIn account disconnected successfully'
    });
  } catch (error) {
    console.error('[LinkedIn] Disconnect error:', error);
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
    console.error('[LinkedIn] List accounts error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
