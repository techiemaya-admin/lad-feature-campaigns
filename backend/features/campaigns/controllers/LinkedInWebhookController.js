/**
 * LinkedIn Webhook Controller
 * Handles webhook operations
 */

const linkedInService = require('../services/LinkedInIntegrationService');
const logger = require('../../../core/utils/logger');

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
        throw new Error('Webhook URL must be provided via webhook_url, UNIPILE_WEBHOOK_URL, WEBHOOK_URL, or BACKEND_URL must be set');
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
      logger.error('[LinkedIn Webhook] Error registering webhook', { error: error.message, stack: error.stack });
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
      logger.error('[LinkedIn Webhook] Error listing webhooks', { error: error.message, stack: error.stack });
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
      logger.info('[LinkedIn Webhook] Webhook received', { body: req.body });
      
      res.json({
        success: true,
        message: 'Webhook received'
      });
    } catch (error) {
      logger.error('[LinkedIn Webhook] Error handling webhook', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to handle webhook'
      });
    }
  }
}

module.exports = LinkedInWebhookController;

