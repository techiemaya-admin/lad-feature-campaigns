/**
 * LinkedIn Token Service
 * Handles token refresh and management
 */

const { pool } = require('../utils/dbConnection');
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');
const logger = require('../../../core/utils/logger');

class LinkedInTokenService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }

  /**
   * Refresh access token for an account
   * @param {Object} account - Account object with credentials
   * @returns {Object} Updated account object
   */
  async refreshAccountToken(account) {
    try {
      const { unipile_account_id, refresh_token } = account;
      
      if (!refresh_token) {
        throw new Error('No refresh token available');
      }
      
      logger.info('[LinkedIn Token] Refreshing token for account', { accountId: unipile_account_id });
      
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      // Check if token is expired
      const expiresAt = account.expires_at ? new Date(account.expires_at) : null;
      if (expiresAt) {
        const now = new Date();
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        // Only refresh if expires within 1 hour
        if (timeUntilExpiry > 60 * 60 * 1000) {
          logger.debug('[LinkedIn Token] Token not expired yet, skipping refresh');
          return account;
        }
      }

      // Refresh token via Unipile
      const tokenResponse = await axios.post(
        `${baseUrl}/oauth/refresh`,
        { refresh_token },
        { headers, timeout: 30000 }
      );

      const tokenData = tokenResponse.data;
      const newExpiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      // Update credentials in database
      const integrationQuery = await pool.query(
        `SELECT id, credentials
         FROM voice_agent.user_integrations_voiceagent
         WHERE (credentials->>'unipile_account_id' = $1 OR credentials->>'account_id' = $1)
         AND provider = 'linkedin'
         LIMIT 1`,
        [unipile_account_id]
      );

      if (integrationQuery.rows.length > 0) {
        const creds = typeof integrationQuery.rows[0].credentials === 'string'
          ? JSON.parse(integrationQuery.rows[0].credentials)
          : (integrationQuery.rows[0].credentials || {});
        
        creds.access_token = tokenData.access_token || creds.access_token;
        creds.refresh_token = tokenData.refresh_token || creds.refresh_token;
        creds.expires_at = newExpiresAt;
        
        await pool.query(
          `UPDATE voice_agent.user_integrations_voiceagent
           SET credentials = $1::jsonb, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(creds), integrationQuery.rows[0].id]
        );
        
        logger.info('[LinkedIn Token] Token refreshed');
      }

      return {
        ...account,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refresh_token,
        expires_at: newExpiresAt
      };
    } catch (error) {
      logger.error('[LinkedIn Token] Error refreshing token', { error: error.message, stack: error.stack });
      // Mark account as disconnected if refresh fails
      return { ...account, status: 'disconnected' };
    }
  }
}

module.exports = new LinkedInTokenService();

