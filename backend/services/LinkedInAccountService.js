/**
 * LinkedIn Account Service
 * Handles account management operations
 */

const { pool } = require('../../../shared/database/connection');
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');

class LinkedInAccountService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }

  /**
   * Disconnect a specific LinkedIn account
   * @param {string} userId - User ID
   * @param {string} unipileAccountId - Unipile account ID to disconnect
   * @returns {Object} Result
   */
  async disconnectAccount(userId, unipileAccountId) {
    try {
      console.log('[LinkedIn Account] Disconnecting account:', unipileAccountId, 'for user:', userId);
      
      // Find integration
      const integrationQuery = await pool.query(
        `SELECT id, credentials
         FROM voice_agent.user_integrations_voiceagent
         WHERE user_id = $1 
         AND provider = 'linkedin'
         AND (credentials->>'unipile_account_id' = $2 OR credentials->>'account_id' = $2)
         LIMIT 1`,
        [userId, unipileAccountId]
      );

      if (integrationQuery.rows.length === 0) {
        throw new Error('LinkedIn account not found for this user');
      }

      const integration = integrationQuery.rows[0];

      // Try to delete from Unipile (don't fail if it errors)
      if (this.baseService.isConfigured()) {
        try {
          const baseUrl = this.baseService.getBaseUrl();
          const headers = this.baseService.getAuthHeaders();
          await axios.delete(
            `${baseUrl}/accounts/${unipileAccountId}`,
            { headers, timeout: 30000 }
          );
        } catch (unipileError) {
          console.warn('[LinkedIn Account] Error deleting from Unipile (continuing):', unipileError.message);
        }
      }

      // Mark as disconnected in database
      await pool.query(
        `UPDATE voice_agent.user_integrations_voiceagent
         SET is_connected = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [integration.id]
      );

      console.log('[LinkedIn Account] ✅ Account disconnected');

      // Get remaining accounts
      const remainingAccounts = await this.getUserLinkedInAccounts(userId);

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
    try {
      const query = `
        SELECT id, credentials, is_connected, connected_at
        FROM voice_agent.user_integrations_voiceagent
        WHERE user_id = $1 
        AND provider = 'linkedin'
        AND is_connected = TRUE
        ORDER BY connected_at DESC NULLS LAST, created_at DESC
      `;
      
      const result = await pool.query(query, [userId]);
      
      return result.rows.map(row => {
        const creds = typeof row.credentials === 'string' 
          ? JSON.parse(row.credentials) 
          : (row.credentials || {});
        
        return {
          unipile_account_id: creds.unipile_account_id || creds.account_id,
          profileName: creds.profile_name || 'LinkedIn User',
          profileUrl: creds.profile_url,
          email: creds.email,
          profileId: creds.profile_id,
          status: row.is_connected ? 'connected' : 'disconnected',
          connectedAt: creds.connected_at || row.connected_at
        };
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error getting user accounts:', error);
      return [];
    }
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
}

module.exports = new LinkedInAccountService();

