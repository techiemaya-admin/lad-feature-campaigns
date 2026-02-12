/**
 * Unipile Connection Tracking Service
 * Handles LinkedIn invitation tracking via Unipile API
 * Polls for accepted/declined invitations and updates database
 * LAD Architecture Compliant
 */

const axios = require('axios');
const logger = require('../../../core/utils/logger');
const LinkedInConnectionRepository = require('../repositories/LinkedInConnectionRepository');
const LinkedInAccountHelper = require('./LinkedInAccountHelper');

const UNIPILE_API = process.env.UNIPILE_API_URL || 'https://api1.unipile.com:13111/api/v1';

class UnipileConnectionTrackingService {
  /**
   * Poll sent invitations and update their status
   * Should be called 3 times per day via cron job
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} - Polling results
   */
  static async pollInvitationStatus(tenantId) {
    try {
      logger.info('[Unipile Connection Tracking] Starting invitation status poll', {
        tenantId: tenantId.substring(0, 8) + '...'
      });

      // Get active LinkedIn accounts for this tenant
      const accountHelper = new LinkedInAccountHelper();
      const accounts = await accountHelper.getActiveLinkedInAccounts(tenantId);

      if (!accounts || accounts.length === 0) {
        logger.warn('[Unipile Connection Tracking] No active LinkedIn accounts found', {
          tenantId: tenantId.substring(0, 8) + '...'
        });
        return {
          success: true,
          message: 'No active LinkedIn accounts to poll',
          stats: { accountsChecked: 0, updated: 0, newAcceptances: 0 }
        };
      }

      const stats = {
        accountsChecked: 0,
        updated: 0,
        newAcceptances: 0,
        newDeclines: 0,
        errors: 0
      };

      // Check each LinkedIn account
      for (const account of accounts) {
        try {
          const accountStats = await this._pollAccountInvitations(
            account.unipile_account_id,
            account.access_token,
            tenantId
          );

          stats.accountsChecked++;
          stats.updated += accountStats.updated;
          stats.newAcceptances += accountStats.newAcceptances;
          stats.newDeclines += accountStats.newDeclines;

        } catch (accountError) {
          logger.error('[Unipile Connection Tracking] Error polling account', {
            accountId: account.unipile_account_id,
            error: accountError.message
          });
          stats.errors++;
        }
      }

      logger.info('[Unipile Connection Tracking] Poll completed', stats);

      return {
        success: true,
        stats
      };

    } catch (error) {
      logger.error('[Unipile Connection Tracking] Poll failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Poll invitations for a single LinkedIn account
   * @private
   */
  static async _pollAccountInvitations(unipileAccountId, accessToken, tenantId) {
    const stats = {
      updated: 0,
      newAcceptances: 0,
      newDeclines: 0
    };

    try {
      // Fetch sent invitations from Unipile
      const response = await axios.get(
        `${UNIPILE_API}/users/invite/sent`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-API-ID': unipileAccountId,
            'accept': 'application/json'
          }
        }
      );

      const invitations = response.data?.data || response.data?.items || [];

      if (invitations.length === 0) {
        return stats;
      }

      // Get all pending connections from our database for this account
      const pendingConnections = await LinkedInConnectionRepository.getPendingConnections(
        unipileAccountId,
        tenantId
      );

      // Create a map of recipient IDs for quick lookup
      const pendingMap = new Map(
        pendingConnections.map(conn => [conn.recipient_linkedin_id || conn.recipient_profile_url, conn])
      );

      // Process each invitation from Unipile
      for (const invitation of invitations) {
        const recipientId = invitation.recipient_id || invitation.recipient?.id;
        const recipientUrl = invitation.recipient_url || invitation.recipient?.profile_url;
        const status = invitation.status; // 'accepted', 'pending', 'declined'

        // Find matching connection in our database
        const existingConnection = pendingMap.get(recipientId) || pendingMap.get(recipientUrl);

        if (!existingConnection) {
          // Connection not tracked in our system, skip
          continue;
        }

        // Update status if changed
        if (existingConnection.status !== status) {
          await LinkedInConnectionRepository.updateConnectionStatus(
            existingConnection.id,
            status,
            tenantId,
            {
              accepted_at: invitation.accepted_at,
              declined_at: invitation.declined_at,
              unipile_invitation_id: invitation.id
            }
          );

          stats.updated++;

          if (status === 'accepted') {
            stats.newAcceptances++;
            logger.info('[Unipile Connection Tracking] Invitation accepted', {
              connectionId: existingConnection.id,
              recipientName: existingConnection.recipient_name
            });

            // Trigger auto-follow-up if configured
            await this._handleAcceptedInvitation(existingConnection, tenantId);
          } else if (status === 'declined') {
            stats.newDeclines++;
            logger.info('[Unipile Connection Tracking] Invitation declined', {
              connectionId: existingConnection.id,
              recipientName: existingConnection.recipient_name
            });
          }
        }
      }

      return stats;

    } catch (error) {
      logger.error('[Unipile Connection Tracking] Error fetching invitations from Unipile', {
        accountId: unipileAccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle accepted invitation - trigger follow-up actions
   * @private
   */
  static async _handleAcceptedInvitation(connection, tenantId) {
    try {
      // Check if campaign has auto-follow-up configured
      if (connection.campaign_id) {
        // TODO: Trigger next step in campaign workflow
        // This could be sending a follow-up message
        logger.info('[Unipile Connection Tracking] Auto-follow-up candidate', {
          connectionId: connection.id,
          campaignId: connection.campaign_id
        });
      }
    } catch (error) {
      logger.error('[Unipile Connection Tracking] Error handling accepted invitation', {
        error: error.message
      });
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Process webhook event from Unipile
   * @param {Object} webhookData - Webhook payload
   * @returns {Promise<Object>} - Processing result
   */
  static async processWebhookEvent(webhookData) {
    try {
      const { event, account_id, data } = webhookData;

      logger.info('[Unipile Connection Tracking] Processing webhook event', {
        event,
        accountId: account_id
      });

      // Handle invitation acceptance/decline events
      if (event === 'invitation_accepted' || event === 'invitation_declined') {
        return await this._processInvitationStatusChange(event, account_id, data);
      }

      // Handle new message events
      if (event === 'message_created') {
        return await this._processNewMessage(account_id, data);
      }

      // Handle message read events
      if (event === 'message_read') {
        return await this._processMessageRead(account_id, data);
      }

      return {
        success: true,
        message: 'Event processed (no action needed)',
        event
      };

    } catch (error) {
      logger.error('[Unipile Connection Tracking] Webhook processing error', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Process invitation status change from webhook
   * @private
   */
  static async _processInvitationStatusChange(event, accountId, data) {
    try {
      const recipientId = data.recipient_id || data.inviter_id;
      const status = event === 'invitation_accepted' ? 'accepted' : 'declined';

      // Find connection in database by Unipile account and recipient
      const connection = await LinkedInConnectionRepository.findByRecipient(
        accountId,
        recipientId
      );

      if (!connection) {
        logger.warn('[Unipile Connection Tracking] Connection not found for webhook', {
          accountId,
          recipientId,
          event
        });
        return {
          success: true,
          message: 'Connection not tracked in system'
        };
      }

      // Update status
      await LinkedInConnectionRepository.updateConnectionStatus(
        connection.id,
        status,
        connection.tenant_id,
        {
          accepted_at: data.accepted_at,
          declined_at: data.declined_at,
          unipile_invitation_id: data.invitation_id
        }
      );

      // Trigger follow-up for accepted invitations
      if (status === 'accepted') {
        await this._handleAcceptedInvitation(connection, connection.tenant_id);
      }

      return {
        success: true,
        message: `Connection status updated to ${status}`,
        connectionId: connection.id
      };

    } catch (error) {
      logger.error('[Unipile Connection Tracking] Error processing invitation status change', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process new message event
   * @private
   */
  static async _processNewMessage(accountId, data) {
    logger.info('[Unipile Connection Tracking] New message received', {
      accountId,
      senderId: data.sender_id,
      chatId: data.chat_id
    });

    // TODO: Save message to database, trigger notification
    return {
      success: true,
      message: 'Message event logged'
    };
  }

  /**
   * Process message read event
   * @private
   */
  static async _processMessageRead(accountId, data) {
    logger.info('[Unipile Connection Tracking] Message read', {
      accountId,
      messageId: data.message_id
    });

    // TODO: Update message read status in database
    return {
      success: true,
      message: 'Message read event logged'
    };
  }

  /**
   * Get connection statistics for analytics
   * @param {string} campaignId - Campaign ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} - Connection stats
   */
  static async getConnectionStats(campaignId, tenantId) {
    try {
      const stats = await LinkedInConnectionRepository.getConnectionStats(
        campaignId,
        tenantId
      );

      return {
        success: true,
        stats: {
          total_sent: stats.total || 0,
          accepted: stats.accepted || 0,
          pending: stats.pending || 0,
          declined: stats.declined || 0,
          acceptance_rate: stats.total > 0 
            ? ((stats.accepted / stats.total) * 100).toFixed(2) 
            : 0
        }
      };

    } catch (error) {
      logger.error('[Unipile Connection Tracking] Error getting connection stats', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = UnipileConnectionTrackingService;
