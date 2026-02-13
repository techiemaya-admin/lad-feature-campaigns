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
      return [];
    }
  }

  /**
   * Register account status webhook with Unipile
   * Receives notifications when account checkpoint is resolved or status changes
   * @param {string} webhookUrl - Full webhook URL (e.g., https://your-domain.com/api/webhooks/linkedin/webhooks/account-status)
   * @returns {Object} Webhook registration result
   */
  async registerAccountStatusWebhook(webhookUrl) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      // Unipile webhook events for account status (valid events per Unipile API):
      // - credentials: When account credentials expire or are invalid
      // - error: When account has errors
      // - ok: When account status is OK (checkpoint resolved, reconnected)
      // - permissions: When permissions are needed
      const events = ['credentials', 'error', 'ok', 'permissions'];
      
      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      const webhookSecret = process.env.WEBHOOK_SECRET || 'lad-webhook-secret';

      const payload = {
        source: 'account_status',
        request_url: webhookUrl,
        events: events,
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
}
module.exports = new LinkedInWebhookService();
