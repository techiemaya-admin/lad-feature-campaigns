/**
 * LinkedIn Connection Repository
 * Database operations for LinkedIn connection tracking using campaign_analytics table
 * LAD Architecture Compliant
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class LinkedInConnectionRepository {
  /**
   * Save new LinkedIn connection request to campaign_analytics
   * @param {Object} connectionData - Connection data
   * @param {string} tenantId - Tenant ID
   * @param {string} schema - Database schema
   * @returns {Promise<Object>} - Created analytics record
   */
  async create(connectionData, tenantId, schema = 'lad_dev') {
    try {
      const query = `
        INSERT INTO ${schema}.campaign_analytics (
          id, campaign_id, lead_id,
          action_type, platform, status,
          lead_name, lead_email, lead_phone,
          message_content, response_data, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
        ) RETURNING *
      `;

      const responseData = {
        unipile_account_id: connectionData.unipile_account_id,
        recipient_linkedin_id: connectionData.recipient_linkedin_id,
        recipient_profile_url: connectionData.recipient_profile_url,
        sent_at: connectionData.sent_at || new Date().toISOString(),
        invitation_status: 'pending'
      };

      const values = [
        connectionData.campaign_id,
        connectionData.lead_id,
        'CONNECTION_SENT', // action_type
        'linkedin', // platform
        'pending', // status
        connectionData.recipient_name,
        null, // lead_email
        null, // lead_phone
        connectionData.invitation_message,
        JSON.stringify(responseData)
      ];

      const result = await pool.query(query, values);
      return result.rows[0];

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Create error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update connection status in campaign_analytics
   * @param {string} connectionId - Connection ID
   * @param {string} newStatus - New status ('accepted', 'declined')
   * @param {string} tenantId - Tenant ID (not used in campaign_analytics but kept for compatibility)
   * @param {Object} additionalData - Additional fields to update
   * @param {string} schema - Database schema
   */
  static async updateConnectionStatus(connectionId, newStatus, tenantId, additionalData = {}, schema = 'lad_dev') {
    try {
      // Get existing record
      const getQuery = `
        SELECT response_data FROM ${schema}.campaign_analytics
        WHERE id = $1
      `;
      const existing = await pool.query(getQuery, [connectionId]);
      
      if (existing.rows.length === 0) {
        throw new Error('Connection record not found');
      }

      // Update response_data with new status
      const responseData = existing.rows[0].response_data || {};
      responseData.invitation_status = newStatus;
      
      if (additionalData.accepted_at) {
        responseData.accepted_at = additionalData.accepted_at;
      }
      if (additionalData.declined_at) {
        responseData.declined_at = additionalData.declined_at;
      }
      if (additionalData.unipile_invitation_id) {
        responseData.unipile_invitation_id = additionalData.unipile_invitation_id;
      }

      // Update status and response_data
      const updateQuery = `
        UPDATE ${schema}.campaign_analytics 
        SET status = $1,
            response_data = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `;

      const statusMap = {
        'accepted': 'success',
        'declined': 'failed',
        'pending': 'pending'
      };

      const result = await pool.query(updateQuery, [
        statusMap[newStatus] || 'pending',
        JSON.stringify(responseData),
        connectionId
      ]);

      return result.rows[0];

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Update status error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get pending connections for a LinkedIn account from campaign_analytics
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} tenantId - Tenant ID (not used but kept for compatibility)
   * @param {string} schema - Database schema
   * @returns {Promise<Array>} - Pending connections
   */
  static async getPendingConnections(unipileAccountId, tenantId, schema = 'lad_dev') {
    try {
      const query = `
        SELECT 
          id,
          campaign_id,
          lead_id,
          lead_name as recipient_name,
          response_data->>'recipient_linkedin_id' as recipient_linkedin_id,
          response_data->>'recipient_profile_url' as recipient_profile_url,
          response_data->>'invitation_status' as status,
          created_at as sent_at,
          response_data
        FROM ${schema}.campaign_analytics
        WHERE action_type = 'CONNECTION_SENT'
          AND platform = 'linkedin'
          AND status = 'pending'
          AND response_data->>'unipile_account_id' = $1
          AND response_data->>'invitation_status' = 'pending'
        ORDER BY created_at DESC
      `;

      const result = await pool.query(query, [unipileAccountId]);
      return result.rows;

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Get pending connections error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Find connection by recipient from campaign_analytics
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} recipientId - Recipient LinkedIn ID
   * @param {string} schema - Database schema
   * @returns {Promise<Object|null>} - Connection or null
   */
  static async findByRecipient(unipileAccountId, recipientId, schema = 'lad_dev') {
    try {
      const query = `
        SELECT 
          id,
          campaign_id,
          lead_id,
          lead_name as recipient_name,
          response_data->>'recipient_linkedin_id' as recipient_linkedin_id,
          response_data->>'recipient_profile_url' as recipient_profile_url,
          response_data->>'invitation_status' as status,
          created_at as sent_at,
          response_data
        FROM ${schema}.campaign_analytics
        WHERE action_type = 'CONNECTION_SENT'
          AND platform = 'linkedin'
          AND response_data->>'unipile_account_id' = $1
          AND (response_data->>'recipient_linkedin_id' = $2 
               OR response_data->>'recipient_profile_url' LIKE $3)
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await pool.query(query, [
        unipileAccountId,
        recipientId,
        `%${recipientId}%`
      ]);

      return result.rows[0] || null;

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Find by recipient error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get connection statistics for a campaign from campaign_analytics
   * @param {string} campaignId - Campaign ID
   * @param {string} tenantId - Tenant ID (not used but kept for compatibility)
   * @param {string} schema - Database schema
   * @returns {Promise<Object>} - Connection stats
   */
  static async getConnectionStats(campaignId, tenantId, schema = 'lad_dev') {
    try {
      const query = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE response_data->>'invitation_status' = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE response_data->>'invitation_status' = 'pending') as pending,
          COUNT(*) FILTER (WHERE response_data->>'invitation_status' = 'declined') as declined
        FROM ${schema}.campaign_analytics
        WHERE campaign_id = $1 
          AND action_type = 'CONNECTION_SENT'
          AND platform = 'linkedin'
      `;

      const result = await pool.query(query, [campaignId]);
      return result.rows[0];

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Get stats error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all connections for a campaign with pagination from campaign_analytics
   * @param {string} campaignId - Campaign ID
   * @param {string} tenantId - Tenant ID (not used but kept for compatibility)
   * @param {Object} options - Pagination and filter options
   * @param {string} schema - Database schema
   * @returns {Promise<Object>} - Connections and metadata
   */
  static async getConnectionsByCampaign(campaignId, tenantId, options = {}, schema = 'lad_dev') {
    try {
      const { limit = 50, offset = 0, status = null } = options;
      
      let query = `
        SELECT 
          ca.id,
          ca.campaign_id,
          ca.lead_id,
          ca.lead_name as recipient_name,
          ca.response_data->>'recipient_linkedin_id' as recipient_linkedin_id,
          ca.response_data->>'recipient_profile_url' as recipient_profile_url,
          ca.response_data->>'invitation_status' as status,
          ca.created_at as sent_at,
          ca.response_data->>'accepted_at' as accepted_at,
          ca.response_data->>'declined_at' as declined_at,
          cl.first_name,
          cl.last_name,
          cl.email
        FROM ${schema}.campaign_analytics ca
        LEFT JOIN ${schema}.campaign_leads cl ON ca.lead_id = cl.id
        WHERE ca.campaign_id = $1 
          AND ca.action_type = 'CONNECTION_SENT'
          AND ca.platform = 'linkedin'
      `;

      const values = [campaignId];

      if (status) {
        query += ` AND ca.response_data->>'invitation_status' = $2`;
        values.push(status);
      }

      query += ` ORDER BY ca.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
      values.push(limit, offset);

      const result = await pool.query(query, values);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total
        FROM ${schema}.campaign_analytics
        WHERE campaign_id = $1 
          AND action_type = 'CONNECTION_SENT'
          AND platform = 'linkedin'
      `;

      const countValues = [campaignId];
      if (status) {
        countQuery += ` AND response_data->>'invitation_status' = $2`;
        countValues.push(status);
      }

      const countResult = await pool.query(countQuery, countValues);

      return {
        connections: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };

    } catch (error) {
      logger.error('[LinkedIn Connection Repository] Get connections by campaign error', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = LinkedInConnectionRepository;
