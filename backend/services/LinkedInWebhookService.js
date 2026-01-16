/**
 * LinkedIn Webhook Service
 * Handles webhook registration and management
 */

const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');
const logger = require('../../../core/utils/logger');

class LinkedInWebhookService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }

  /**
   * Register webhook with Unipile
   * @param {string} webhookUrl - Webhook URL
   * @param {Array} events - Events to subscribe to
   * @param {string} source - Source type (users or connections)
   * @returns {Object} Webhook registration result
   */
  async registerWebhook(webhookUrl, events = ['new_relation'], source = 'users') {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const payload = {
        source,
        request_url: webhookUrl,
        events
      };

      const response = await axios.post(
        `${baseUrl}/webhooks`,
        payload,
        { headers, timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      logger.error('[LinkedIn Webhook] Error registering webhook', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * List webhooks
   * @returns {Array} List of webhooks
   */
  async listWebhooks() {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const response = await axios.get(
        `${baseUrl}/webhooks`,
        { headers, timeout: 30000 }
      );

      return Array.isArray(response.data) 
        ? response.data 
        : (response.data?.data || response.data?.webhooks || []);
    } catch (error) {
      logger.error('[LinkedIn Webhook] Error listing webhooks', { error: error.message, stack: error.stack });
      return [];
    }
  }
}

module.exports = new LinkedInWebhookService();

