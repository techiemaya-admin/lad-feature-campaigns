/**
 * LinkedIn OAuth Service
 * Handles OAuth flow and account connection
 */
const { pool } = require('../../../shared/database/connection');
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');
const { extractLinkedInProfileUrl } = require('./LinkedInProfileHelper');
const { handleCheckpointResponse } = require('./LinkedInCheckpointService');
// Try to load Unipile SDK (optional dependency)
let UnipileClient = null;
try {
  UnipileClient = require('unipile-node-sdk').UnipileClient;
} catch (sdkError) {
}
class LinkedInOAuthService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }
  /**
   * Start LinkedIn OAuth connection flow
   * @param {string} userId - User ID
   * @param {string} redirectUri - OAuth callback URL
   * @returns {string} OAuth authorization URL
   */
  async startLinkedInConnection(userId, redirectUri) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured. Please set UNIPILE_DSN and UNIPILE_TOKEN');
      }
      const baseUrl = this.baseService.getBaseUrl();
      const authUrl = `${baseUrl}/oauth/linkedin/authorize?` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${encodeURIComponent(userId)}`;
      return authUrl;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Handle LinkedIn OAuth callback
   * Stores account info in voice_agent.user_integrations_voiceagent table
   * @param {string} userId - User ID
   * @param {string} code - Authorization code
   * @param {string} redirectUri - OAuth callback URL
   * @returns {Object} Account information
   */
  async handleLinkedInCallback(userId, code, redirectUri) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }
      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      // Exchange code for tokens
      const tokenResponse = await axios.post(
        `${baseUrl}/oauth/linkedin/callback`,
        {
          code,
          redirect_uri: redirectUri
        },
        {
          headers,
          timeout: 30000
        }
      );
      const tokenData = tokenResponse.data;
      const unipileAccountId = tokenData.account_id || tokenData.account?.id;
      if (!unipileAccountId) {
        throw new Error('No account ID returned from Unipile');
      }
      // Get account details
      const accountDetails = await this.getAccountDetails(unipileAccountId);
      const profileName = accountDetails?.profile_name || 
                         accountDetails?.name || 
                         accountDetails?.profile?.name || 
                         'LinkedIn User';
      const profileUrl = accountDetails?.profile_url || 
                        accountDetails?.url || 
                        accountDetails?.profile?.url || 
                        null;
      const email = accountDetails?.email || 
                   accountDetails?.profile?.email || 
                   null;
      const profileId = accountDetails?.profile_id || 
                       accountDetails?.id || 
                       null;
      // Calculate expiration time
      const expiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // Default 60 days
      // Prepare credentials JSONB
      const credentials = {
        unipile_account_id: unipileAccountId,
        access_token: tokenData.access_token || null,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        profile_name: profileName,
        profile_id: profileId,
        profile_url: profileUrl,
        email: email,
        connected_at: new Date().toISOString()
      };
      // Check if integration already exists
      const existingQuery = await pool.query(
        `SELECT id, credentials, is_connected
         FROM ${schema}.user_integrations_voiceagent
         WHERE user_id = $1 
         AND provider = 'linkedin'
         AND (credentials->>'unipile_account_id' = $2 OR credentials->>'account_id' = $2)
         LIMIT 1`,
        [userId, unipileAccountId]
      );
      if (existingQuery.rows.length > 0) {
        // Update existing integration
        await pool.query(
          `UPDATE ${schema}.user_integrations_voiceagent
           SET credentials = $1::jsonb,
               is_connected = TRUE,
               connected_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(credentials), existingQuery.rows[0].id]
        );
      } else {
        // Create new integration
        await pool.query(
          `INSERT INTO ${schema}.user_integrations_voiceagent
           (user_id, provider, credentials, is_connected, connected_at, created_at, updated_at)
           VALUES ($1, 'linkedin', $2::jsonb, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, JSON.stringify(credentials)]
        );
      }
      return {
        success: true,
        account: {
          unipile_account_id: unipileAccountId,
          profileName,
          profileUrl,
          email,
          profileId,
          connectedAt: credentials.connected_at
        }
      };
    } catch (error) {
      throw error;
    }
  }
  /**
   * Connect account with credentials or cookies
   * Uses Unipile SDK (like pluto_campaigns) instead of direct HTTP API
   * @param {Object} params - Connection parameters
   * @returns {Object} Result
   */
  async connectAccount(params) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }
      const { method, email, password, li_at, li_a, user_agent } = params;
      if (!method || (method !== 'credentials' && method !== 'cookies')) {
        throw new Error('Invalid method. Must be "credentials" or "cookies"');
      }
      // Get base URL and prepare SDK base URL (SDK expects URL without /api/v1)
      const baseUrl = this.baseService.getBaseUrl();
      let sdkBaseUrl = baseUrl;
      if (sdkBaseUrl.endsWith('/api/v1')) {
        sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
      } else if (sdkBaseUrl.endsWith('/api/v1/')) {
        sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1\/$/, '');
      }
      // Try SDK first (preferred method like pluto_campaigns)
      if (UnipileClient) {
        try {
          // Get token from baseService or environment
          const token = (this.baseService.dsn && this.baseService.token) 
            ? this.baseService.token.trim() 
            : (process.env.UNIPILE_TOKEN || '').trim();
          if (!token) {
            throw new Error('UNIPILE_TOKEN is not configured');
          }
          const unipile = new UnipileClient(sdkBaseUrl, token);
          if (method === 'credentials') {
            if (!email || !password) {
              throw new Error('Email and password are required for credentials method');
            }
            const account = await unipile.account.connectLinkedin({
              username: email,
              password: password
            });
            // Check if response is a checkpoint (OTP/2FA required)
            if (account && account.object === 'Checkpoint' && account.checkpoint) {
              return await handleCheckpointResponse(account, unipile, email);
            }
            return account;
          } else if (method === 'cookies') {
            if (!li_at) {
              throw new Error('li_at cookie is required for cookies method');
            }
            const account = await unipile.account.connectLinkedin({
              cookies: {
                li_at: li_at,
                li_a: li_a || undefined
              },
              user_agent: user_agent || 'your-app/1.0'
            });
            // Check if response is a checkpoint (OTP/2FA required) - same logic as credentials
            if (account && account.object === 'Checkpoint' && account.checkpoint) {
              return await handleCheckpointResponse(account, unipile, account.email);
            }
            return account;
          }
        } catch (sdkError) {
          // Fall through to HTTP fallback
          throw sdkError;
        }
      } else {
        // SDK not available, try HTTP API (fallback)
        const headers = this.baseService.getAuthHeaders();
        let payload = {};
        if (method === 'credentials') {
          payload = { username: email, password };
        } else if (method === 'cookies') {
          payload = { 
            provider: 'LINKEDIN',
            cookies: {
              li_at: li_at,
              li_a: li_a || undefined
            },
            user_agent: user_agent || 'your-app/1.0'
          };
        }
        try {
          const response = await axios.post(
            `${baseUrl}/accounts`,
            payload,
            { headers, timeout: 60000 }
          );
          return response.data;
        } catch (apiError) {
          // Handle 404 - endpoint doesn't exist
          if (apiError.response?.status === 404) {
            throw new Error(
              'LinkedIn connection endpoint not found. Please install unipile-node-sdk: npm install unipile-node-sdk'
            );
          }
          // Re-throw other errors
          throw apiError;
        }
      }
    } catch (error) {
      throw error;
    }
  }
  /**
   * Reconnect account
   * @param {string} unipileAccountId - Unipile account ID
   * @returns {Object} Result
   */
  async reconnectAccount(unipileAccountId) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }
      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      const response = await axios.post(
        `${baseUrl}/accounts/${unipileAccountId}/reconnect`,
        {},
        { headers, timeout: 30000 }
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Get account details from Unipile
   * Uses SDK (like pluto_campaigns) instead of HTTP API
   * @param {string} unipileAccountId - Unipile account ID
   * @returns {Object} Account details
   */
  async getAccountDetails(unipileAccountId) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }
      // Try SDK first (preferred method like pluto_campaigns)
      if (UnipileClient) {
        try {
          const baseUrl = this.baseService.getBaseUrl();
          let sdkBaseUrl = baseUrl;
          if (sdkBaseUrl.endsWith('/api/v1')) {
            sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
          } else if (sdkBaseUrl.endsWith('/api/v1/')) {
            sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1\/$/, '');
          }
          const token = (this.baseService.dsn && this.baseService.token) 
            ? this.baseService.token.trim() 
            : (process.env.UNIPILE_TOKEN || '').trim();
          if (!token) {
            throw new Error('UNIPILE_TOKEN is not configured');
          }
          const unipile = new UnipileClient(sdkBaseUrl, token);
          if (unipile.account && typeof unipile.account.getOne === 'function') {
            const accountDetails = await unipile.account.getOne(unipileAccountId);
            return accountDetails;
          } else {
            throw new Error('SDK account.getOne method not available');
          }
        } catch (sdkError) {
          // Fall through to HTTP fallback
        }
      }
      // Fallback to HTTP API if SDK not available or failed
      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      const response = await axios.get(
        `${baseUrl}/accounts/${unipileAccountId}`,
        { headers, timeout: 30000 }
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // Account not found
      }
      throw error;
    }
  }
}
// Export the service instance and the helper function
const serviceInstance = new LinkedInOAuthService();
serviceInstance.extractLinkedInProfileUrl = extractLinkedInProfileUrl; // For backward compatibility
module.exports = serviceInstance;