/**
 * LinkedIn Account Controller
 * Handles account management operations
 */

const linkedInService = require('../services/LinkedInIntegrationService');

class LinkedInAccountController {
  /**
   * Get all connected LinkedIn accounts for user
   * GET /api/campaigns/linkedin/accounts
   */
  static async getAccounts(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      console.log('[LinkedIn Account] Getting accounts for user:', userId);
      
      const accounts = await linkedInService.getUserLinkedInAccounts(userId);
      
      res.json({
        success: true,
        connected: accounts.length > 0,
        accounts: accounts,
        totalAccounts: accounts.length
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error getting accounts:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get LinkedIn accounts'
      });
    }
  }

  /**
   * Get account status
   * GET /api/campaigns/linkedin/status
   */
  static async getStatus(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      console.log('[LinkedIn Account] Getting status for user:', userId);
      
      const accounts = await linkedInService.getUserLinkedInAccounts(userId);
      
      // Build connections array for frontend
      const connections = accounts.map(account => ({
        id: account.unipile_account_id,
        connected: account.status === 'connected',
        status: account.status,
        profileName: account.profileName,
        profileUrl: account.profileUrl,
        email: account.email,
        connectedAt: account.connectedAt,
        connectionMethod: 'oauth',
        unipileAccountId: account.unipile_account_id
      }));
      
      const hasConnected = connections.some(conn => conn.connected);
      const primaryStatus = connections.length > 0 ? connections[0].status : 'disconnected';
      
      res.json({
        connected: hasConnected,
        status: primaryStatus,
        connections: connections,
        totalConnections: connections.length
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error getting status:', error);
      res.status(500).json({
        connected: false,
        status: 'error',
        error: error.message || 'Failed to get LinkedIn status',
        connections: []
      });
    }
  }

  /**
   * Get account status
   * GET /api/campaigns/linkedin/account-status
   */
  static async getAccountStatus(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.query;
      
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

      const accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
      
      res.json({
        success: true,
        account: accountDetails
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error getting account status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get account status'
      });
    }
  }

  /**
   * Disconnect a specific LinkedIn account
   * POST /api/campaigns/linkedin/disconnect
   */
  static async disconnect(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const unipileAccountId = req.body.unipileAccountId || req.query.unipileAccountId;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      if (!unipileAccountId) {
        return res.status(400).json({
          success: false,
          error: 'unipileAccountId is required to disconnect a specific account'
        });
      }
      
      console.log('[LinkedIn Account] Disconnecting account:', unipileAccountId, 'for user:', userId);
      
      const result = await linkedInService.disconnectAccount(userId, unipileAccountId);
      
      // Get all remaining accounts
      const remainingAccounts = await linkedInService.getUserLinkedInAccounts(userId);
      
      // Build connections array for frontend
      const connections = remainingAccounts.map(account => ({
        id: account.unipile_account_id,
        connected: account.status === 'connected',
        status: account.status,
        profileName: account.profileName,
        profileUrl: account.profileUrl,
        email: account.email,
        connectedAt: account.connectedAt,
        connectionMethod: 'oauth',
        unipileAccountId: account.unipile_account_id
      }));
      
      const hasConnected = connections.some(conn => conn.connected);
      const primaryStatus = connections.length > 0 ? connections[0].status : 'disconnected';
      
      res.json({
        success: true,
        message: 'LinkedIn account disconnected successfully',
        disconnectedAccountId: unipileAccountId,
        remainingAccounts: result.remainingAccounts,
        connected: hasConnected,
        status: primaryStatus,
        connections: connections,
        totalConnections: connections.length
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error disconnecting:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to disconnect LinkedIn account'
      });
    }
  }

  /**
   * Sync account data (connections, messages)
   * POST /api/campaigns/linkedin/sync
   */
  static async sync(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const unipileAccountId = req.body.unipileAccountId || req.query.unipileAccountId;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      console.log('[LinkedIn Account] Syncing account data for user:', userId);
      
      // Get user accounts
      const accounts = await linkedInService.getUserLinkedInAccounts(userId);
      
      if (accounts.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No connected LinkedIn accounts found'
        });
      }
      
      // Sync specific account or all accounts
      const accountsToSync = unipileAccountId
        ? accounts.filter(acc => acc.unipile_account_id === unipileAccountId)
        : accounts;
      
      const syncResults = [];
      
      for (const account of accountsToSync) {
        const result = await linkedInService.syncAccountData({ ...account, userId });
        syncResults.push({
          unipileAccountId: account.unipile_account_id,
          ...result
        });
      }
      
      res.json({
        success: true,
        message: 'Account data synced successfully',
        results: syncResults
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error syncing:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to sync account data'
      });
    }
  }

  /**
   * Sync from Unipile
   * GET /api/campaigns/linkedin/sync-from-unipile
   */
  static async syncFromUnipile(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.query;
      
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

      const result = await linkedInService.syncFromUnipile(unipileAccountId);
      
      res.json(result);
    } catch (error) {
      console.error('[LinkedIn Account] Error syncing from Unipile:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to sync from Unipile'
      });
    }
  }

  /**
   * Refresh token manually
   * POST /api/campaigns/linkedin/refresh
   */
  static async refreshToken(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.body;
      
      // Get account
      let account = null;
      if (account_id) {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        account = accounts.find(acc => acc.unipile_account_id === account_id);
      } else {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        if (accounts.length > 0) {
          account = accounts[0];
        }
      }

      if (!account) {
        return res.status(404).json({
          success: false,
          error: 'No LinkedIn account found'
        });
      }

      const updatedAccount = await linkedInService.refreshAccountToken(account);
      
      res.json({
        success: true,
        message: 'Token refreshed successfully',
        account: updatedAccount
      });
    } catch (error) {
      console.error('[LinkedIn Account] Error refreshing token:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to refresh token'
      });
    }
  }
}

module.exports = LinkedInAccountController;

