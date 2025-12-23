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
                        `${process.env.BACKEND_URL || 'http://localhost:3004'}/api/campaigns/linkedin/webhook`;
      
      const webhookEvents = events || ['new_relation'];
      const webhookSource = source || 'users';

      const result = await linkedInService.registerWebhook(webhookUrl, webhookEvents, webhookSource);
      
      res.json({
        success: true,
        message: 'Webhook registered successfully',
        webhook: result
      });
    } catch (error) {
      console.error('[LinkedIn Webhook] Error registering webhook:', error);
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
      console.error('[LinkedIn Webhook] Error listing webhooks:', error);
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
      console.log('[LinkedIn Webhook] Webhook received:', JSON.stringify(req.body, null, 2));
      
      res.json({
        success: true,
        message: 'Webhook received'
      });
    } catch (error) {
      console.error('[LinkedIn Webhook] Error handling webhook:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to handle webhook'
      });
    }
  }
}

module.exports = LinkedInWebhookController;

