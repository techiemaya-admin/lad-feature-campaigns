/**
 * LinkedIn Integration Routes for Campaigns
 * Uses campaign's own LinkedIn integration services
 */

const express = require('express');
const router = express.Router();
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
const linkedInIntegrationService = require('../services/LinkedInIntegrationService');

// GET /api/campaigns/linkedin/status - Check LinkedIn connection status
router.get('/status', jwtAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(userId);
    
    res.json({
      success: true,
      connected: accounts && accounts.length > 0,
      accountCount: accounts ? accounts.length : 0,
      accounts: accounts || []
    });
  } catch (error) {
    console.error('[LinkedIn] Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/campaigns/linkedin/connect - Connect LinkedIn account (OAuth or credentials)
router.post('/connect', jwtAuth, async (req, res) => {
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
    const userId = req.user.userId;
    const { unipileAccountId } = req.body;
    
    if (!unipileAccountId) {
      return res.status(400).json({
        success: false,
        error: 'unipileAccountId is required'
      });
    }
    
    await linkedInIntegrationService.disconnectAccount(userId, unipileAccountId);
    
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
    const userId = req.user.userId;
    const accounts = await linkedInIntegrationService.getUserLinkedInAccounts(userId);
    
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
