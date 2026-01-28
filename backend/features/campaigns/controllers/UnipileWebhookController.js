/**
 * Unipile Webhook Controller
 * Handles webhook callbacks from Unipile for LinkedIn events
 * LAD Architecture Compliant
 */

const logger = require('../../../core/utils/logger');
const UnipileConnectionTrackingService = require('../services/UnipileConnectionTrackingService');

class UnipileWebhookController {
  /**
   * POST /api/campaigns/webhooks/unipile
   * Receives webhook events from Unipile
   * 
   * Expected payload:
   * {
   *   "event": "invitation_accepted" | "invitation_declined" | "message_created" | "message_read",
   *   "account_id": "unipile_account_id",
   *   "data": { ... event specific data ... }
   * }
   */
  static async handleWebhook(req, res) {
    try {
      const webhookData = req.body;

      logger.info('[Unipile Webhook Controller] Received webhook', {
        event: webhookData.event,
        accountId: webhookData.account_id
      });

      // Validate webhook data
      if (!webhookData || !webhookData.event || !webhookData.account_id) {
        return res.status(400).json({
          success: false,
          error: 'Invalid webhook payload'
        });
      }

      // Process webhook via service layer
      const result = await UnipileConnectionTrackingService.processWebhookEvent(webhookData);

      // Must respond with 200 within 30 seconds (Unipile requirement)
      return res.status(200).json({
        success: true,
        message: 'Webhook received and processed',
        ...result
      });

    } catch (error) {
      logger.error('[Unipile Webhook Controller] Error handling webhook', {
        error: error.message,
        stack: error.stack
      });

      // Still return 200 to prevent Unipile retries on our app errors
      return res.status(200).json({
        success: false,
        error: 'Webhook received but processing failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/webhooks/unipile/test
   * Test endpoint for webhook verification
   */
  static async testWebhook(req, res) {
    logger.info('[Unipile Webhook Controller] Test endpoint called', {
      body: req.body
    });

    res.json({
      success: true,
      message: 'Unipile webhook endpoint is working',
      timestamp: new Date().toISOString(),
      received: req.body
    });
  }

  /**
   * POST /api/campaigns/connections/poll
   * Manually trigger polling for invitation status
   * Called by cron job 3 times per day
   */
  static async manualPoll(req, res) {
    try {
      const tenantId = req.user.tenantId;

      logger.info('[Unipile Webhook Controller] Manual poll triggered', {
        tenantId: tenantId.substring(0, 8) + '...',
        triggeredBy: req.user.userId
      });

      // Trigger polling via service
      const result = await UnipileConnectionTrackingService.pollInvitationStatus(tenantId);

      return res.json({
        success: true,
        message: 'Invitation status poll completed',
        ...result
      });

    } catch (error) {
      logger.error('[Unipile Webhook Controller] Manual poll error', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to poll invitation status',
        details: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id/connections/stats
   * Get connection statistics for a campaign (for analytics page)
   */
  static async getConnectionStats(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId } = req.params;

      const result = await UnipileConnectionTrackingService.getConnectionStats(
        campaignId,
        tenantId
      );

      return res.json(result);

    } catch (error) {
      logger.error('[Unipile Webhook Controller] Get stats error', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get connection stats',
        details: error.message
      });
    }
  }
}

module.exports = UnipileWebhookController;
