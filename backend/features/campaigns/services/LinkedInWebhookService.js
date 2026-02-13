/**
 * LinkedIn Webhook Service
 * Handles webhook registration and management
 */
const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');
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
        throw new Error('LinkedIn integration service is not configured. Please contact support.');
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
        throw new Error('LinkedIn integration service is not configured. Please contact support.');
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
      return [];
    }
  }

  /**
   * Register account status webhook for real-time LinkedIn account updates
   * @param {string} webhookUrl - Your backend webhook endpoint URL
   * @returns {Promise<Object>} Webhook registration result
   */
  async registerAccountStatusWebhook(webhookUrl) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('LinkedIn integration service is not configured. Please contact support.');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      const webhookSecret = process.env.WEBHOOK_SECRET || 'lad-webhook-secret';

      const payload = {
        source: 'account_status', // Account status changes (OK, CREDENTIALS, ERROR, etc.)
        request_url: webhookUrl,
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json'
          },
          {
            key: 'X-Webhook-Secret',
            value: webhookSecret
          }
        ]
      };

      const response = await axios.post(
        `${baseUrl}/webhooks`,
        payload,
        { headers, timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a webhook by ID
   * @param {string} webhookId - Webhook ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteWebhook(webhookId) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('LinkedIn integration service is not configured. Please contact support.');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      await axios.delete(
        `${baseUrl}/webhooks/${webhookId}`,
        { headers, timeout: 30000 }
      );

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Verify webhook secret from incoming webhook request
   * @param {string} receivedSecret - Secret from webhook request headers
   * @returns {boolean} Valid or not
   */
  verifyWebhookSecret(receivedSecret) {
    const expectedSecret = process.env.WEBHOOK_SECRET || 'lad-webhook-secret';
    return receivedSecret === expectedSecret;
  }
}
module.exports = new LinkedInWebhookService();
