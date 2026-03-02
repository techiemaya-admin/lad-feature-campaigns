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

  /**
   * Register message webhook with Unipile
   * Receives notifications for incoming and outgoing messages
   * @param {string} webhookUrl - Full webhook URL
   */
  async registerMessageWebhook(webhookUrl) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();
      const webhookSecret = process.env.WEBHOOK_SECRET || 'lad-webhook-secret';

      const payload = {
        source: 'messaging',
        request_url: webhookUrl,
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json'
          },
          {
            key: 'unipile-auth',
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
   * Process incoming message from Unipile (LinkedIn chat reply)
   * Connects the msg to campaign_analytics based on chat_id stored in response_data
   * @param {Object} msg - The message payload from Unipile webhook
   */
  async processIncomingMessage(msg) {
    try {
      if (!msg.chat_id) return;

      const { pool } = require('../../../shared/database/connection');
      const logger = require('../../../core/utils/logger');
      const schema = process.env.DB_SCHEMA || 'lad_dev'; // fallback to lad_dev

      // 1. Find the previous analytics row (like CONTACTED) that has the chat_id and all data filled
      const findQuery = `
        SELECT 
          ca.campaign_id, ca.lead_id, ca.tenant_id, 
          ca.account_name, ca.provider_account_id, ca.user_id,
          ca.lead_name, ca.lead_linkedin, ca.lead_email, ca.lead_phone,
          cl.id as campaign_lead_id
        FROM ${schema}.campaign_analytics ca
        JOIN ${schema}.campaign_leads cl ON cl.lead_id = ca.lead_id AND cl.campaign_id = ca.campaign_id
        WHERE ca.platform = 'linkedin'
          AND ca.response_data::text LIKE $1
          AND ca.account_name IS NOT NULL
        ORDER BY ca.created_at DESC
        LIMIT 1
      `;
      const result = await pool.query(findQuery, [`%${msg.chat_id}%`]);

      if (result.rows.length === 0) {
        logger.info('[LinkedInWebhook] Received message but could not match to an existing campaign chat', { chatId: msg.chat_id });
        return;
      }

      const {
        lead_id, campaign_id, tenant_id, campaign_lead_id,
        account_name, provider_account_id, user_id,
        lead_name, lead_linkedin, lead_email, lead_phone
      } = result.rows[0];

      // 2. Insert into campaign_analytics to mark REPLY_RECEIVED
      const analyticsQuery = `
        INSERT INTO ${schema}.campaign_analytics (
          campaign_id, lead_id, action_type, platform, status,
          message_content, response_data, created_at, updated_at, tenant_id,
          account_name, provider_account_id, user_id,
          lead_name, lead_linkedin, lead_email, lead_phone
        ) VALUES ($1, $2, 'REPLY_RECEIVED', 'linkedin', 'success', $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9, $10, $11, $12)
      `;
      await pool.query(analyticsQuery, [
        campaign_id, lead_id, msg.text || 'Reply received', JSON.stringify({ chatId: msg.chat_id, source: 'unipile_webhook' }), tenant_id,
        account_name, provider_account_id, user_id,
        lead_name, lead_linkedin, lead_email, lead_phone
      ]);

      // 3. Insert into campaign_lead_activities for LIVE FEED and stepper progression
      const createActivityQuery = `
        INSERT INTO ${schema}.campaign_lead_activities (
          tenant_id, campaign_id, campaign_lead_id, step_type, action_type, status,
          channel, message_content, created_at
        ) VALUES ($1, $2, $3, 'linkedin_message', 'REPLY_RECEIVED', 'replied', 'linkedin', $4, CURRENT_TIMESTAMP)
      `;
      await pool.query(createActivityQuery, [
        tenant_id, campaign_id, campaign_lead_id, msg.text || 'Reply received'
      ]);

      logger.info('[LinkedInWebhook] Successfully processed incoming reply', { campaign_id, lead_id });
    } catch (e) {
      const logger = require('../../../core/utils/logger');
      logger.error('[LinkedInWebhook] Failed to process incoming message', e);
    }
  }
}
module.exports = new LinkedInWebhookService();
