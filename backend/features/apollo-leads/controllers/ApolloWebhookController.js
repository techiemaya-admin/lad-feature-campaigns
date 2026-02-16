/**
 * Apollo Webhook Controller
 * Receives phone reveal data from Apollo.io webhooks
 * LAD Architecture Compliant
 */

const logger = require('../../../core/utils/logger');
const ApolloWebhookService = require('../services/ApolloWebhookService');

class ApolloWebhookController {
  /**
   * POST /api/apollo-leads/webhook/phone-reveal
   * Receives phone number from Apollo webhook
   * 
   * Apollo sends:
   * {
   *   "person": {
   *     "id": "apollo_person_id",
   *     "name": "John Doe",
   *     "phone_numbers": ["+1234567890"],
   *     "sanitized_phone": "+1234567890",
   *     ...other fields
   *   }
   * }
   */
  static async handlePhoneReveal(req, res) {
    try {
      logger.info('[Apollo Webhook Controller] Received webhook', {
        hasBody: !!req.body,
        hasPerson: !!req.body?.person
      });

      // Validate webhook signature (if needed in future)
      if (!ApolloWebhookService.validateWebhookSignature(req)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid webhook signature'
        });
      }

      // Process webhook via service layer
      const result = await ApolloWebhookService.processPhoneReveal(req.body);

      // Return success to Apollo
      return res.json(result);

    } catch (error) {
      logger.error('[Apollo Webhook Controller] Error handling webhook', {
        error: error.message,
        stack: error.stack
      });

      // Always return 200 to Apollo to prevent retries on our app errors
      // If it's a validation error (4xx), we can return the appropriate code
      if (error.message.includes('Invalid') || error.message.includes('Missing')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: error.message
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * POST /api/apollo-leads/webhook/test
   * Test endpoint to verify webhook is working
   */
  static async testWebhook(req, res) {
    logger.info('[Apollo Webhook Controller] Test endpoint called');
    
    res.json({
      success: true,
      message: 'Webhook endpoint is working',
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = ApolloWebhookController;
