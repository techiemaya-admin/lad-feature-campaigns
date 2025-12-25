/**
 * LinkedIn Auth Controller
 * Handles OAuth, connection, and checkpoint operations
 */

const linkedInService = require('../services/LinkedInIntegrationService');
const { pool } = require('../../../shared/database/connection');

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
                        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings/linkedin/callback`;
      
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
                        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings/linkedin/callback`;
      
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const successUrl = `${frontendUrl}/settings?linkedin=connected&accountId=${result.account.unipile_account_id}`;
      
      res.redirect(successUrl);
    } catch (error) {
      console.error('[LinkedIn Auth] Error handling callback:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
      const userId = req.user.userId || req.user.user_id;
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
        if (error.response && error.response.status === 404) {
          return res.status(404).json({
            success: false,
            error: 'LinkedIn connect endpoint not found in Unipile API. This may require a different API version or endpoint path.',
            details: error.response.data?.message || error.message
          });
        }
        throw error; // Re-throw other errors
      }

      // If connection successful, save to database
      if (result && (result.account_id || result.id)) {
        const unipileAccountId = result.account_id || result.id;
        const accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
        
        if (accountDetails && userId) {
          // Save to database (similar to callback)
          const credentials = {
            unipile_account_id: unipileAccountId,
            profile_name: accountDetails.profile_name || accountDetails.name || 'LinkedIn User',
            profile_url: accountDetails.profile_url || accountDetails.url,
            email: accountDetails.email,
            connected_at: new Date().toISOString()
          };

          await pool.query(
            `INSERT INTO voice_agent.user_integrations_voiceagent
             (user_id, provider, credentials, is_connected, connected_at, created_at, updated_at)
             VALUES ($1, 'linkedin', $2::jsonb, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, provider) DO UPDATE
             SET credentials = $2::jsonb, is_connected = TRUE, connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
            [userId, JSON.stringify(credentials)]
          );
        }
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
      const { answer, account_id } = req.body;
      
      if (!answer || (answer !== 'YES' && answer !== 'NO')) {
        return res.status(400).json({
          success: false,
          error: 'Answer is required and must be YES or NO'
        });
      }

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

      const result = await linkedInService.solveCheckpoint(unipileAccountId, answer);
      
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
      const { otp, account_id } = req.body;
      
      if (!otp) {
        return res.status(400).json({
          success: false,
          error: 'OTP is required'
        });
      }

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
}

module.exports = LinkedInAuthController;

