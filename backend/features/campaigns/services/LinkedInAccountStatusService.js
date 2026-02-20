/**
 * LinkedIn Account Status Service
 * Handles business logic for account status updates from webhooks
 * LAD Architecture: Service Layer (NO SQL - calls Repository)
 */

const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
const { getSocketService } = require('../../../shared/services/socketService');
const logger = require('../../../core/utils/logger');
const { pool } = require('../../../shared/database/connection');

const linkedInAccountRepository = new LinkedInAccountRepository(pool);

class LinkedInAccountStatusService {
  /**
   * Process account status webhook
   * LAD Architecture: Service contains business logic, calls repository for data
   * @param {Object} accountStatusPayload - Webhook payload
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Processing result
   */
  async processAccountStatusWebhook(accountStatusPayload, context = {}) {
    const { account_id, account_type, message, status } = accountStatusPayload;

    // Unipile sends 'status' field, but also support 'message' for compatibility
    const accountStatus = status || message;

    logger.info('[LinkedInAccountStatus] Processing account status update', {
      accountId: account_id,
      accountType: account_type,
      status: accountStatus
    });

    try {
      // Map Unipile status to database status
      const statusMap = {
        'OK': 'active',
        'CREDENTIALS': 'credentials_expired',
        'ERROR': 'error',
        'STOPPED': 'stopped',
        'CONNECTING': 'connecting',
        'CREATION_SUCCESS': 'active',
        'RECONNECTED': 'active',
        'SYNC_SUCCESS': 'active'
      };

      const dbStatus = statusMap[accountStatus] || 'unknown';
      const needsReconnect = accountStatus === 'CREDENTIALS';

      // Update account status via repository (LAD: Service → Repository)
      await linkedInAccountRepository.updateAccountStatus(
        account_id,
        dbStatus,
        needsReconnect,
        context
      );

      // Get account details for real-time notification
      const account = await linkedInAccountRepository.getAccountByUnipileId(account_id, context);

      if (account) {
        // Emit real-time update to frontend
        await this.emitAccountStatusUpdate(account, accountStatus, dbStatus, needsReconnect);
      }

      return {
        success: true,
        accountId: account_id,
        status: accountStatus,
        dbStatus: dbStatus
      };

    } catch (error) {
      logger.error('[LinkedInAccountStatus] Failed to process account status', {
        accountId: account_id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Emit real-time status update to frontend via Socket.IO
   * @param {Object} account - Account data from repository
   * @param {string} unipileStatus - Original Unipile status
   * @param {string} dbStatus - Mapped database status
   * @param {boolean} needsReconnect - Reconnect flag
   */
  async emitAccountStatusUpdate(account, unipileStatus, dbStatus, needsReconnect) {
    try {
      const socketService = getSocketService();
      
      if (!socketService.io) {
        logger.warn('[LinkedInAccountStatus] Socket.IO not initialized - skipping real-time update');
        return;
      }

      // Emit to tenant-specific room for multi-tenancy
      const tenantRoom = `tenant:${account.tenant_id}`;
      
      socketService.io.to(tenantRoom).emit('linkedin:account:status', {
        accountId: account.unipile_account_id,
        accountName: account.account_name,
        status: unipileStatus,
        dbStatus: dbStatus,
        needsReconnect: needsReconnect,
        timestamp: new Date().toISOString()
      });

      logger.info('[LinkedInAccountStatus] Real-time update emitted', {
        room: tenantRoom,
        accountId: account.unipile_account_id,
        status: unipileStatus
      });

    } catch (error) {
      logger.error('[LinkedInAccountStatus] Failed to emit real-time update', {
        accountId: account.unipile_account_id,
        error: error.message
      });
      // Don't throw - real-time notification failure shouldn't break webhook processing
    }
  }

  /**
   * Get account status summary for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Account status summary
   */
  async getAccountStatusSummary(tenantId, context = {}) {
    try {
      const accounts = await linkedInAccountRepository.getAllAccountsForTenant(tenantId, context);
      
      const summary = {
        total: accounts.length,
        active: 0,
        needsReconnect: 0,
        error: 0
      };

      accounts.forEach(account => {
        if (account.status === 'active') summary.active++;
        if (account.needs_reconnect) summary.needsReconnect++;
        if (account.status === 'error' || account.status === 'credentials_expired') summary.error++;
      });

      return {
        success: true,
        summary,
        accounts
      };

    } catch (error) {
      logger.error('[LinkedInAccountStatus] Failed to get account status summary', {
        tenantId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new LinkedInAccountStatusService();
