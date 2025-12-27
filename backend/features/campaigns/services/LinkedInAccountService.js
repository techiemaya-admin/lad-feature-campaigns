/**
 * LinkedIn Account Service
 * Handles account management operations
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');
const { getUserLinkedInAccounts, findAccountByUnipileId } = require('./LinkedInAccountQueryService');

class LinkedInAccountService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }

  /**
   * Disconnect a specific LinkedIn account
   * Uses TDD schema: ${schema}.linkedin_accounts with tenant_id (UUID)
   * @param {string} tenantId - Tenant ID (UUID)
   * @param {string} unipileAccountId - Unipile account ID to disconnect
   * @returns {Object} Result
   */
  async disconnectAccount(tenantId, unipileAccountId) {
    try {
      console.log('[LinkedIn Account] Disconnecting account:', unipileAccountId, 'for tenant:', tenantId);
      
      const schema = getSchema(req);
      // Try TDD schema first (${schema}.linkedin_accounts)
      const accountResult = await findAccountByUnipileId(tenantId, unipileAccountId);
      
      if (!accountResult || !accountResult.account) {
        throw new Error('LinkedIn account not found for this tenant/user');
      }
      
      const account = accountResult.account;
      const schema = accountResult.schema;
      
      // Try to delete from Unipile using SDK (don't fail if it errors)
      if (this.baseService.isConfigured()) {
        try {
          // Try SDK first
          const { UnipileClient } = require('unipile-node-sdk');
          const baseUrl = this.baseService.getBaseUrl();
          let sdkBaseUrl = baseUrl;
          if (sdkBaseUrl.endsWith('/api/v1')) {
            sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
          }
          
          const token = (this.baseService.dsn && this.baseService.token) 
            ? this.baseService.token.trim() 
            : (process.env.UNIPILE_TOKEN || '').trim();
          
          if (token) {
            const unipile = new UnipileClient(sdkBaseUrl, token);
            if (unipile.account && typeof unipile.account.delete === 'function') {
              await unipile.account.delete(unipileAccountId);
              console.log('[LinkedIn Account] ✅ Account deleted from Unipile via SDK');
            } else {
              throw new Error('SDK delete method not available');
            }
          }
        } catch (sdkError) {
          // Fallback to HTTP API
          try {
            const baseUrl = this.baseService.getBaseUrl();
            const headers = this.baseService.getAuthHeaders();
            await axios.delete(
              `${baseUrl}/accounts/${unipileAccountId}`,
              { headers, timeout: 30000 }
            );
            console.log('[LinkedIn Account] ✅ Account deleted from Unipile via HTTP');
          } catch (httpError) {
            console.warn('[LinkedIn Account] Error deleting from Unipile (continuing):', httpError.message);
          }
        }
      }

      // Mark as inactive/disconnected in database
      if (schema === 'tdd') {
        await pool.query(
          `UPDATE ${schema}.linkedin_accounts
           SET is_active = FALSE,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [account.id]
        );
        console.log('[LinkedIn Account] ✅ Account disconnected (TDD schema)');
      } else {
        await pool.query(
          `UPDATE voice_agent.user_integrations_voiceagent
           SET is_connected = FALSE,
           updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [account.id]
        );
        console.log('[LinkedIn Account] ✅ Account disconnected (fallback schema)');
      }

      // Get remaining accounts
      const remainingAccounts = await getUserLinkedInAccounts(tenantId);

      return {
        success: true,
        disconnectedAccountId: unipileAccountId,
        remainingAccounts: remainingAccounts.length,
        remainingAccountsList: remainingAccounts
      };
    } catch (error) {
      console.error('[LinkedIn Account] Error disconnecting account:', error);
      throw error;
    }
  }

  /**
   * Get all connected LinkedIn accounts for a user
   * @param {string} userId - User ID
   * @returns {Array} List of connected accounts
   */
  async getUserLinkedInAccounts(userId) {
    return await getUserLinkedInAccounts(userId);
  }

  /**
   * Get all connected accounts across all users (for cron jobs)
   * @returns {Array} Array of {userId, account} objects
   */
  async getAllConnectedAccounts() {
    try {
      const query = `
        SELECT user_id, credentials, is_connected
        FROM voice_agent.user_integrations_voiceagent
        WHERE provider = 'linkedin'
        AND is_connected = TRUE
        ORDER BY connected_at DESC
      `;
      
      const result = await pool.query(query);
      
      return result.rows.map(row => {
        const creds = typeof row.credentials === 'string' 
          ? JSON.parse(row.credentials) 
          : (row.credentials || {});
        
        return {
          userId: row.user_id,
          account: {
            unipile_account_id: creds.unipile_account_id || creds.account_id,
            refresh_token: creds.refresh_token,
            expires_at: creds.expires_at,
            access_token: creds.access_token,
            status: row.is_connected ? 'connected' : 'disconnected'
          }
        };
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error getting all accounts:', error);
      return [];
    }
  }

  /**
   * Sync account data (connections, messages, etc.)
   * @param {Object} account - Account object
   * @returns {Object} Sync result
   */
  async syncAccountData(account) {
    try {
      const { unipile_account_id } = account;
      
      console.log('[LinkedIn Account] Syncing account data:', unipile_account_id);
      
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      // Fetch connections
      let connections = [];
      try {
        const connResponse = await axios.get(
          `${baseUrl}/accounts/${unipile_account_id}/connections`,
          { headers, timeout: 30000 }
        );
        connections = Array.isArray(connResponse.data) 
          ? connResponse.data 
          : (connResponse.data?.data || connResponse.data?.connections || []);
      } catch (err) {
        console.warn('[LinkedIn Account] Error fetching connections:', err.message);
      }

      // Update lastSyncedAt in credentials
      const userId = account.userId;
      if (userId) {
        const integrationQuery = await pool.query(
          `SELECT id, credentials
           FROM voice_agent.user_integrations_voiceagent
           WHERE user_id = $1 
           AND provider = 'linkedin'
           AND (credentials->>'unipile_account_id' = $2 OR credentials->>'account_id' = $2)
           LIMIT 1`,
          [userId, unipile_account_id]
        );

        if (integrationQuery.rows.length > 0) {
          const creds = typeof integrationQuery.rows[0].credentials === 'string'
            ? JSON.parse(integrationQuery.rows[0].credentials)
            : (integrationQuery.rows[0].credentials || {});
          
          creds.lastSyncedAt = new Date().toISOString();
          
          await pool.query(
            `UPDATE voice_agent.user_integrations_voiceagent
             SET credentials = $1::jsonb, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [JSON.stringify(creds), integrationQuery.rows[0].id]
          );
        }
      }

      return {
        success: true,
        connectionsCount: connections.length
      };
    } catch (error) {
      console.error('[LinkedIn Account] Error syncing account data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sync from Unipile (get account status)
   * @param {string} unipileAccountId - Unipile account ID
   * @returns {Object} Account status
   */
  async syncFromUnipile(unipileAccountId) {
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

      const accountDetails = response.data;
      
      if (!accountDetails) {
        return { success: false, error: 'Account not found' };
      }

      // Update credentials with latest info
      const integrationQuery = await pool.query(
        `SELECT id, credentials, user_id
         FROM voice_agent.user_integrations_voiceagent
         WHERE (credentials->>'unipile_account_id' = $1 OR credentials->>'account_id' = $1)
         AND provider = 'linkedin'
         LIMIT 1`,
        [unipileAccountId]
      );

      if (integrationQuery.rows.length > 0) {
        const creds = typeof integrationQuery.rows[0].credentials === 'string'
          ? JSON.parse(integrationQuery.rows[0].credentials)
          : (integrationQuery.rows[0].credentials || {});
        
        // Update with latest profile info
        creds.profile_name = accountDetails.profile_name || accountDetails.name || creds.profile_name;
        creds.profile_url = accountDetails.profile_url || accountDetails.url || creds.profile_url;
        creds.email = accountDetails.email || creds.email;
        
        await pool.query(
          `UPDATE voice_agent.user_integrations_voiceagent
           SET credentials = $1::jsonb, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(creds), integrationQuery.rows[0].id]
        );
      }

      return {
        success: true,
        account: accountDetails
      };
    } catch (error) {
      console.error('[LinkedIn Account] Error syncing from Unipile:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Solve checkpoint (Yes/No validation)
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} answer - YES or NO
   * @param {string} checkpointType - Checkpoint type (default: IN_APP_VALIDATION)
   * @returns {Object} Result
   */
  async solveCheckpoint(unipileAccountId, answer, checkpointType = 'IN_APP_VALIDATION') {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

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

      // Try SDK first (like pluto_campaigns)
      const { UnipileClient } = require('unipile-node-sdk');
      const unipile = new UnipileClient(sdkBaseUrl, token);

      let solveResponse;
      if (unipile.account && typeof unipile.account.solveCheckpoint === 'function') {
        console.log('[LinkedIn Account] Using SDK solveCheckpoint()');
        solveResponse = await unipile.account.solveCheckpoint({
          account_id: unipileAccountId,
          type: checkpointType,
          answer: answer
        });
      } else {
        // Fallback to HTTP
        console.log('[LinkedIn Account] SDK method not available, using HTTP fallback');
        const headers = this.baseService.getAuthHeaders();
        const response = await axios.post(
          `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
          {
            type: checkpointType,
            answer: answer
          },
          { headers, timeout: 30000 }
        );
        solveResponse = response.data;
      }

      console.log('[LinkedIn Account] ✅ Checkpoint solved successfully');
      return solveResponse;
    } catch (error) {
      console.error('[LinkedIn Account] Error solving checkpoint:', error);
      throw error;
    }
  }

  /**
   * Verify OTP for checkpoint
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} otp - OTP code
   * @returns {Object} Result
   */
  async verifyOTP(unipileAccountId, otp) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

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

      // Try SDK first (like pluto_campaigns)
      const { UnipileClient } = require('unipile-node-sdk');
      const unipile = new UnipileClient(sdkBaseUrl, token);

      let verificationResponse;
      if (unipile.account && typeof unipile.account.solveCodeCheckpoint === 'function') {
        console.log('[LinkedIn Account] Using SDK solveCodeCheckpoint()');
        verificationResponse = await unipile.account.solveCodeCheckpoint({
          provider: 'LINKEDIN',
          account_id: unipileAccountId,
          code: otp
        });
      } else {
        // Fallback to HTTP
        console.log('[LinkedIn Account] SDK method not available, using HTTP fallback');
        const headers = this.baseService.getAuthHeaders();
        const response = await axios.post(
          `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
          {
            type: 'OTP',
            code: otp
          },
          { headers, timeout: 30000 }
        );
        verificationResponse = response.data;
      }

      console.log('[LinkedIn Account] ✅ OTP verified successfully');
      return verificationResponse;
    } catch (error) {
      console.error('[LinkedIn Account] Error verifying OTP:', error);
      throw error;
    }
  }
}

module.exports = new LinkedInAccountService();

