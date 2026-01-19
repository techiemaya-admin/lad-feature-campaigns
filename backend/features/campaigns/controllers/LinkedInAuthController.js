/**
 * LinkedIn Auth Controller
 * Handles OAuth, connection, and checkpoint operations
 */

const linkedInService = require('../services/LinkedInIntegrationService');
const { getSchema } = require('../../../core/utils/schemaHelper');
const linkedInAccountStorage = require('../services/LinkedInAccountStorageService');
const logger = require('../../../core/utils/logger');

class LinkedInAuthController {
  /**
   * Start LinkedIn OAuth flow
   * GET /api/campaigns/linkedin/auth/start
   */
  static async startAuth(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const redirectUri = req.query.redirect_uri || 
                        req.body.redirect_uri || 
                        process.env.LINKEDIN_REDIRECT_URI || 
                        (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/settings/linkedin/callback` : null);
      
      if (!redirectUri) {
        return res.status(400).json({
          success: false,
          error: 'Redirect URI must be provided via redirect_uri parameter, LINKEDIN_REDIRECT_URI, or FRONTEND_URL must be set'
        });
      }
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      logger.info('[LinkedIn Auth] Starting OAuth', { userId });
      
      const authUrl = await linkedInService.startLinkedInConnection(userId, redirectUri);
      
      res.json({
        success: true,
        authUrl: authUrl,
        message: 'Redirect user to authUrl to complete LinkedIn connection'
      });
    } catch (error) {
      logger.error('[LinkedIn Auth] Error starting auth', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to start LinkedIn authentication'
      });
    }
  }

  /**
   * Handle LinkedIn OAuth callback
   * GET /api/campaigns/linkedin/auth/callback
   */
  static async handleCallback(req, res) {
    try {
      const { code, state } = req.query;
      const redirectUri = req.query.redirect_uri || 
                        process.env.LINKEDIN_REDIRECT_URI || 
                        (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/settings/linkedin/callback` : null);
      
      if (!redirectUri) {
        return res.status(400).json({
          success: false,
          error: 'Redirect URI must be provided via redirect_uri parameter, LINKEDIN_REDIRECT_URI, or FRONTEND_URL must be set'
        });
      }
      
      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Authorization code is required'
        });
      }
      
      const userId = state || req.user?.userId || req.user?.user_id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      logger.info('[LinkedIn Auth] Handling callback', { userId });
      
      const result = await linkedInService.handleLinkedInCallback(userId, code, redirectUri);
      
      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        return res.status(500).json({
          success: false,
          error: 'FRONTEND_URL must be set for redirect'
        });
      }
      const successUrl = `${frontendUrl}/settings?linkedin=connected&accountId=${result.account.unipile_account_id}`;
      
      res.redirect(successUrl);
    } catch (error) {
      logger.error('[LinkedIn Auth] Error handling callback', { error: error.message, stack: error.stack });
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        return res.status(500).json({
          success: false,
          error: 'FRONTEND_URL must be set for redirect'
        });
      }
      const errorUrl = `${frontendUrl}/settings?linkedin=error&message=${encodeURIComponent(error.message)}`;
      res.redirect(errorUrl);
    }
  }

  /**
   * Connect account manually
   * POST /api/campaigns/linkedin/connect
   */
  static async connect(req, res) {
    try {
      // Use tenantId per TDD (linkedin_accounts table uses tenant_id)
      const tenantId = req.user.tenantId || req.user.userId || req.user.user_id;
      const { method, email, password, li_at, li_a, user_agent } = req.body;
      
      if (!method || (method !== 'credentials' && method !== 'cookies')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid method. Must be "credentials" or "cookies"'
        });
      }

      if (method === 'credentials' && (!email || !password)) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required for credentials method'
        });
      }

      if (method === 'cookies' && (!li_at && !li_a)) {
        return res.status(400).json({
          success: false,
          error: 'li_at or li_a cookie is required for cookies method'
        });
      }

      let result;
      try {
        result = await linkedInService.connectAccount({
          method,
          email,
          password,
          li_at,
          li_a,
          user_agent
        });
      } catch (error) {
        // Handle Unipile API errors gracefully
        const errorMessage = error.message || 'Failed to connect LinkedIn account';
        
        // Check if it's the 404 error we're handling
        if (errorMessage.includes('not supported by this Unipile API version') || 
            errorMessage.includes('404') ||
            (error.response && error.response.status === 404)) {
          return res.status(501).json({
            success: false,
            error: 'LinkedIn connection via credentials is not supported',
            message: 'The Unipile API endpoint for credential-based LinkedIn connection is not available. Please use one of the following alternatives:',
            alternatives: [
              {
                method: 'OAuth',
                description: 'Use LinkedIn OAuth flow for secure connection',
                endpoint: '/api/campaigns/linkedin/auth/start'
              },
              {
                method: 'Unipile Dashboard',
                description: 'Connect your LinkedIn account through the Unipile dashboard',
                action: 'Visit your Unipile dashboard to connect LinkedIn accounts'
              }
            ],
            details: errorMessage
          });
        }
        
        // Handle other errors
        logger.error('[LinkedIn Auth] Connection error', { error: error.message, stack: error.stack, status: error.response?.status });
        return res.status(error.response?.status || 500).json({
          success: false,
          error: errorMessage,
          details: error.response?.data || error.message
        });
      }

      // Check if result is a checkpoint (OTP/2FA required)
      if (result && result.object === 'Checkpoint' && result.checkpoint) {
        logger.info('[LinkedIn Auth] Checkpoint required, returning checkpoint info to frontend');
        
        const accountId = result.account_id || result.id || result._id;
        const tenantId = req.user.tenantId || req.user.userId || req.user.user_id;
        
        // Extract profile info from result
        const profileName = result.profileName || result.profile_name || 
                           (result.email ? result.email.split('@')[0] : 'LinkedIn User');
        const profileUrl = result.profileUrl || result.profile_url || null;
        const accountEmail = result.email || email || null;
        
        // Return checkpoint response (matching pluto_campaigns format)
        return res.json({
          success: true,
          checkpoint: result.checkpoint,
          account_id: accountId,
          profileName: profileName,
          profileUrl: profileUrl,
          email: accountEmail,
          unipileAccount: {
            id: accountId,
            state: 'checkpoint',
            lastChecked: new Date().toISOString()
          }
        });
      }
      
      // If connection successful, save to database
      // SDK response might have account_id, id, _id, or accountId
      const unipileAccountId = result.account_id || result.id || result._id || result.accountId;
      
      if (unipileAccountId) {
            logger.info('[LinkedIn Auth] Account connected', { accountId: unipileAccountId });
        
        // SDK response might already contain account details, try to use them first
        let accountDetails = result;
        
        // If SDK response doesn't have profile info, fetch it
        if (!accountDetails.profile_name && !accountDetails.profile_url && !accountDetails.name) {
          try {
            logger.debug('[LinkedIn Auth] Fetching account details from Unipile');
            accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
          } catch (detailError) {
            logger.warn('[LinkedIn Auth] Could not fetch account details, using connection response', { error: detailError.message });
            // Use the connection response as fallback
            accountDetails = result;
          }
        }
        
        const schema = getSchema(req);
        // Use tenantId for TDD schema (${schema}.linkedin_accounts uses tenant_id)
        const tenantId = req.user.tenantId || req.user.userId || req.user.user_id;
        
        if (tenantId) {
          // Use the extractLinkedInProfileUrl function from LinkedInOAuthService
          // First try to extract from account details, then from connection result
          let profileUrl = null;
          
          // Try account details first (most reliable)
          if (accountDetails) {
            profileUrl = linkedInService.extractLinkedInProfileUrl(accountDetails);
          }
          
          // If not found, try the connection result
          if (!profileUrl && result) {
            profileUrl = linkedInService.extractLinkedInProfileUrl(result);
          }
          
          // Extract profile information from account details or result
          const profileName = accountDetails?.profile_name || 
                             accountDetails?.name || 
                             accountDetails?.profile?.name || 
                             result?.profile_name ||
                             result?.name ||
                             (result?.email ? result.email.split('@')[0] : 'LinkedIn User');
          const email = accountDetails?.email || 
                      accountDetails?.profile?.email || 
                      result?.email ||
                      null;
          
          // Save to database
          const credentials = {
            unipile_account_id: unipileAccountId,
            profile_name: profileName,
            profile_url: profileUrl,
            email: email,
            connected_at: new Date().toISOString()
          };

          logger.info('[LinkedIn Auth] Saving account to database', {
            tenant_id: tenantId,
            unipile_account_id: unipileAccountId,
            profile_name: profileName,
            has_profile_url: !!profileUrl
          });

          // Use service to save account (handles database operations)
          await linkedInAccountStorage.saveLinkedInAccount(tenantId, credentials);
        }
      } else {
        logger.warn('[LinkedIn Auth] Connection successful but no account ID found in response', { responseKeys: Object.keys(result || {}) });
      }

      res.json({
        success: true,
        message: 'Account connected successfully',
        result
      });
    } catch (error) {
      logger.error('[LinkedIn Auth] Error connecting', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to connect account'
      });
    }
  }

  /**
   * Reconnect account
   * POST /api/campaigns/linkedin/reconnect
   */
  static async reconnect(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.body;
      
      // Get account ID
      let unipileAccountId = account_id;
      if (!unipileAccountId && userId) {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        if (accounts.length > 0) {
          unipileAccountId = accounts[0].unipile_account_id;
        }
      }

      if (!unipileAccountId) {
        return res.status(400).json({
          success: false,
          error: 'Account ID is required'
        });
      }

      const result = await linkedInService.reconnectAccount(unipileAccountId);
      
      res.json({
        success: true,
        message: 'Account reconnected successfully',
        result
      });
    } catch (error) {
      logger.error('[LinkedIn Auth] Error reconnecting', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reconnect account'
      });
    }
  }

  // Checkpoint methods moved to LinkedInCheckpointController.js
  // Import and delegate:
  static async solveCheckpoint(req, res) {
    const LinkedInCheckpointController = require('./LinkedInCheckpointController');
    return LinkedInCheckpointController.solveCheckpoint(req, res);
  }

  static async verifyOTP(req, res) {
    const LinkedInCheckpointController = require('./LinkedInCheckpointController');
    return LinkedInCheckpointController.verifyOTP(req, res);
  }

  static async getCheckpointStatus(req, res) {
    const LinkedInCheckpointController = require('./LinkedInCheckpointController');
    return LinkedInCheckpointController.getCheckpointStatus(req, res);
  }
}

module.exports = LinkedInAuthController;

