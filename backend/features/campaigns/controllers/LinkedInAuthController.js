/**
 * LinkedIn Auth Controller
 * Handles OAuth, connection, and checkpoint operations
 */

const linkedInService = require('../services/LinkedInIntegrationService');
const { getSchema } = require('../../../../core/utils/schemaHelper');
const linkedInAccountStorage = require('../services/LinkedInAccountStorageService');

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
      
      console.log('[LinkedIn Auth] Starting OAuth for user:', userId);
      
      const authUrl = await linkedInService.startLinkedInConnection(userId, redirectUri);
      
      res.json({
        success: true,
        authUrl: authUrl,
        message: 'Redirect user to authUrl to complete LinkedIn connection'
      });
    } catch (error) {
      console.error('[LinkedIn Auth] Error starting auth:', error);
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
      
      console.log('[LinkedIn Auth] Handling callback for user:', userId);
      
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
      console.error('[LinkedIn Auth] Error handling callback:', error);
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
        console.error('[LinkedIn Auth] Connection error:', error);
        return res.status(error.response?.status || 500).json({
          success: false,
          error: errorMessage,
          details: error.response?.data || error.message
        });
      }

      // Check if result is a checkpoint (OTP/2FA required)
      if (result && result.object === 'Checkpoint' && result.checkpoint) {
        console.log('[LinkedIn Auth] ⚠️ Checkpoint required, returning checkpoint info to frontend');
        
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
        console.log('[LinkedIn Auth] Account connected, ID:', unipileAccountId);
        
        // SDK response might already contain account details, try to use them first
        let accountDetails = result;
        
        // If SDK response doesn't have profile info, fetch it
        if (!accountDetails.profile_name && !accountDetails.profile_url && !accountDetails.name) {
          try {
            console.log('[LinkedIn Auth] Fetching account details from Unipile...');
            accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
          } catch (detailError) {
            console.warn('[LinkedIn Auth] Could not fetch account details, using connection response:', detailError.message);
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

          console.log('[LinkedIn Auth] Saving account to database:', {
            tenant_id: tenantId,
            unipile_account_id: unipileAccountId,
            profile_name: profileName,
            has_profile_url: !!profileUrl
          });

          // Use service to save account (handles database operations)
          await linkedInAccountStorage.saveLinkedInAccount(tenantId, credentials);
        }
      } else {
        console.warn('[LinkedIn Auth] ⚠️ Connection successful but no account ID found in response');
        console.warn('[LinkedIn Auth] Response keys:', Object.keys(result || {}));
      }

      res.json({
        success: true,
        message: 'Account connected successfully',
        result
      });
    } catch (error) {
      console.error('[LinkedIn Auth] Error connecting:', error);
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
      console.error('[LinkedIn Auth] Error reconnecting:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reconnect account'
      });
    }
  }

  /**
   * Solve checkpoint (Yes/No validation)
   * POST /api/campaigns/linkedin/solve-checkpoint
   */
  static async solveCheckpoint(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { answer, account_id, email } = req.body;
      
      if (!answer || (answer !== 'YES' && answer !== 'NO')) {
        return res.status(400).json({
          success: false,
          error: 'Answer is required and must be YES or NO'
        });
      }

      // Get account ID from request or database
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
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

      // Get checkpoint type from database (default: IN_APP_VALIDATION)
      let checkpointType = 'IN_APP_VALIDATION';
      try {
        const { pool } = require('../utils/dbConnection');
        const tenantId = req.user.tenantId || userId;
        
        // Try TDD schema first
        const checkpointQuery = `
          SELECT metadata
          const schema = getSchema(req);
          FROM ${schema}.linkedin_accounts
          WHERE unipile_account_id = $1 AND tenant_id = $2 AND is_active = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const checkpointResult = await pool.query(checkpointQuery, [unipileAccountId, tenantId]);
        
        if (checkpointResult.rows.length > 0) {
          const metadata = typeof checkpointResult.rows[0].metadata === 'string'
            ? JSON.parse(checkpointResult.rows[0].metadata)
            : (checkpointResult.rows[0].metadata || {});
          checkpointType = metadata.checkpoint?.type || 'IN_APP_VALIDATION';
        }
      } catch (dbError) {
        console.warn('[LinkedIn Auth] Could not get checkpoint type from database, using default:', dbError.message);
      }

      const result = await linkedInService.solveCheckpoint(unipileAccountId, answer, checkpointType);
      
      res.json({
        success: true,
        message: 'Checkpoint solved successfully',
        result
      });
    } catch (error) {
      console.error('[LinkedIn Auth] Error solving checkpoint:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to solve checkpoint'
      });
    }
  }

  /**
   * Verify OTP
   * POST /api/campaigns/linkedin/verify-otp
   */
  static async verifyOTP(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { otp, account_id, email } = req.body;
      
      if (!otp) {
        return res.status(400).json({
          success: false,
          error: 'OTP is required'
        });
      }

      // Get account ID from request or database
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
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

      const result = await linkedInService.verifyOTP(unipileAccountId, otp);
      
      res.json({
        success: true,
        message: 'OTP verified successfully',
        result
      });
    } catch (error) {
      console.error('[LinkedIn Auth] Error verifying OTP:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify OTP'
      });
    }
  }

  /**
   * Get checkpoint status (for polling Yes/No checkpoints)
   * GET /api/campaigns/linkedin/checkpoint-status
   */
  static async getCheckpointStatus(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.query;
      
      // Get account ID
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
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

      // Get account details from Unipile to check checkpoint status
      const accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
      
      // Check if account is still in checkpoint state
      const isCheckpoint = accountDetails?.checkpoint && accountDetails.checkpoint.required;
      const isConnected = accountDetails?.state === 'connected' || accountDetails?.status === 'connected';
      
      res.json({
        success: true,
        connected: isConnected && !isCheckpoint,
        status: isConnected ? 'connected' : (isCheckpoint ? 'checkpoint' : 'disconnected'),
        checkpoint: accountDetails?.checkpoint || null
      });
    } catch (error) {
      console.error('[LinkedIn Auth] Error getting checkpoint status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get checkpoint status'
      });
    }
  }
}

module.exports = LinkedInAuthController;

