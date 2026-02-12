/**
 * LinkedIn Webhook Controller
 * Handles webhook operations
 */
const linkedInService = require('../services/LinkedInIntegrationService');
class LinkedInWebhookController {
  /**
   * Register webhook
   * POST /api/campaigns/linkedin/register-webhook
   */
  static async registerWebhook(req, res) {
    try {
      const { webhook_url, events, source } = req.body;
      const webhookUrl = webhook_url || 
                        process.env.UNIPILE_WEBHOOK_URL || 
                        process.env.WEBHOOK_URL ||
                        (process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/campaigns/linkedin/webhook` : null);
      if (!webhookUrl) {
        throw new Error('Webhook URL configuration is missing. Please contact support.');
      }
      const webhookEvents = events || ['new_relation'];
      const webhookSource = source || 'users';
      const result = await linkedInService.registerWebhook(webhookUrl, webhookEvents, webhookSource);
      res.json({
        success: true,
        message: 'Webhook registered successfully',
        webhook: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to register webhook'
      });
    }
  }
  /**
   * List webhooks
   * GET /api/campaigns/linkedin/webhooks
   */
  static async listWebhooks(req, res) {
    try {
      const webhooks = await linkedInService.listWebhooks();
      res.json({
        success: true,
        webhooks
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list webhooks'
      });
    }
  }
  /**
   * Handle webhook
   * POST /api/campaigns/linkedin/webhook
   */
  static async handleWebhook(req, res) {
    try {
      // Webhook handling will be implemented in LinkedInWebhookService
      // For now, just acknowledge receipt
      res.json({
        success: true,
        message: 'Webhook received'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to handle webhook'
      });
    }
  }

  /**
   * Handle account status webhook from Unipile (real-time updates)
   * POST /api/campaigns/linkedin/webhooks/account-status
   * LAD Architecture: Controller handles HTTP only, calls Service for business logic
   */
  static async handleAccountStatusWebhook(req, res) {
    try {
      const linkedInWebhookService = require('../services/LinkedInWebhookService');
      const linkedInAccountStatusService = require('../services/LinkedInAccountStatusService');
      const logger = require('../../../core/utils/logger');

      // Verify webhook secret
      const receivedSecret = req.headers['x-webhook-secret'];
      if (!linkedInWebhookService.verifyWebhookSecret(receivedSecret)) {
        logger.warn('[LinkedInWebhook] Invalid webhook secret');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { AccountStatus } = req.body;
      
      if (!AccountStatus) {
        logger.warn('[LinkedInWebhook] Missing AccountStatus in payload');
        return res.status(400).json({ error: 'Invalid payload' });
      }

      // LAD: Controller → Service (Service handles business logic and calls Repository for SQL)
      const result = await linkedInAccountStatusService.processAccountStatusWebhook(
        AccountStatus,
        { user: req.user } // Pass context for tenant scoping
      );

      // Must respond with 200 within 30 seconds for Unipile
      return res.status(200).json({ 
        success: result.success,
        message: result.success ? 'Account status updated' : result.error
      });

    } catch (error) {
      const logger = require('../../../core/utils/logger');
      logger.error('[LinkedInWebhook] Error processing webhook', {
        error: error.message,
        stack: error.stack
      });
      
      // Still return 200 to prevent Unipile retries for processing errors
      return res.status(200).json({ success: false, error: error.message });
    }
  }

  /**
   * Register account status webhook
   * POST /api/campaigns/linkedin/webhooks/register-account-status
   */
  static async registerAccountStatusWebhook(req, res) {
    try {
      const linkedInWebhookService = require('../services/LinkedInWebhookService');
      
      const { webhookUrl } = req.body;
      const finalWebhookUrl = webhookUrl || 
        (process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/campaigns/linkedin/webhooks/account-status` : null);

      if (!finalWebhookUrl) {
        return res.status(400).json({
          success: false,
          error: 'webhookUrl is required or BACKEND_URL must be set'
        });
      }

      const result = await linkedInWebhookService.registerAccountStatusWebhook(finalWebhookUrl);

      return res.json({
        success: true,
        message: 'Account status webhook registered successfully',
        webhook: result
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}
module.exports = LinkedInWebhookController;
