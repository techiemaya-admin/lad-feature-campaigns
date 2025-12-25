/**
 * LinkedIn OAuth Service
 * Handles OAuth flow and account connection
 */

const { pool } = require('../../../shared/database/connection');
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');

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
      
      console.log('[LinkedIn OAuth] Generated OAuth URL for user:', userId);
      return authUrl;
    } catch (error) {
      console.error('[LinkedIn OAuth] Error starting connection:', error);
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
      console.log('[LinkedIn OAuth] Handling OAuth callback for user:', userId);
      
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
         FROM voice_agent.user_integrations_voiceagent
         WHERE user_id = $1 
         AND provider = 'linkedin'
         AND (credentials->>'unipile_account_id' = $2 OR credentials->>'account_id' = $2)
         LIMIT 1`,
        [userId, unipileAccountId]
      );

      if (existingQuery.rows.length > 0) {
        // Update existing integration
        await pool.query(
          `UPDATE voice_agent.user_integrations_voiceagent
           SET credentials = $1::jsonb,
               is_connected = TRUE,
               connected_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(credentials), existingQuery.rows[0].id]
        );
        console.log('[LinkedIn OAuth] Updated existing integration');
      } else {
        // Create new integration
        await pool.query(
          `INSERT INTO voice_agent.user_integrations_voiceagent
           (user_id, provider, credentials, is_connected, connected_at, created_at, updated_at)
           VALUES ($1, 'linkedin', $2::jsonb, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, JSON.stringify(credentials)]
        );
        console.log('[LinkedIn OAuth] Created new integration');
      }

      console.log('[LinkedIn OAuth] ✅ Account saved to database');

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
      console.error('[LinkedIn OAuth] Error handling callback:', error);
      throw error;
    }
  }

  /**
   * Connect account with credentials or cookies
   * @param {Object} params - Connection parameters
   * @returns {Object} Result
   */
  async connectAccount(params) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const { method, email, password, li_at, li_a, user_agent } = params;

      let payload = {};
      if (method === 'credentials') {
        payload = { username: email, password };
      } else if (method === 'cookies') {
        payload = { li_at, li_a, user_agent };
      } else {
        throw new Error('Invalid method. Must be "credentials" or "cookies"');
      }

      const response = await axios.post(
        `${baseUrl}/accounts/linkedin/connect`,
        payload,
        { headers, timeout: 60000 }
      );

      return response.data;
    } catch (error) {
      console.error('[LinkedIn OAuth] Error connecting account:', error);
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
      console.error('[LinkedIn OAuth] Error reconnecting account:', error);
      throw error;
    }
  }

  /**
   * Get account details from Unipile
   * @param {string} unipileAccountId - Unipile account ID
   * @returns {Object} Account details
   */
  async getAccountDetails(unipileAccountId) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const response = await axios.get(
        `${baseUrl}/accounts/${unipileAccountId}`,
        { headers, timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      console.error('[LinkedIn OAuth] Error getting account details:', error.message);
      if (error.response?.status === 404) {
        return null; // Account not found
      }
      throw error;
    }
  }
}

module.exports = new LinkedInOAuthService();

