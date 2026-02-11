/**
 * LinkedIn Polling Repository
 * Data access layer for LinkedIn connection polling
 * 
 * LAD Architecture: Repository Layer (SQL ONLY)
 * - All database queries for polling feature
 * - NO business logic
 * - Tenant-scoped queries only
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');

class LinkedInPollingRepository {
  /**
   * Get all active LinkedIn accounts for polling
   * @param {Object} context - Request context with tenant info
   * @returns {Promise<Array>} LinkedIn accounts
   */
  async getActiveLinkedInAccounts(context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        id, 
        tenant_id, 
        account_name, 
        provider_account_id as unipile_account_id,
        status
      FROM ${schema}.social_linkedin_accounts
      WHERE provider = 'unipile'
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Get active LinkedIn accounts for specific tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Array>} LinkedIn accounts
   */
  async getLinkedInAccountsByTenant(tenantId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        id, 
        tenant_id, 
        account_name, 
        provider_account_id as unipile_account_id,
        status
      FROM ${schema}.social_linkedin_accounts
      WHERE tenant_id = $1
        AND provider = 'unipile'
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [tenantId]);
    return result.rows;
  }

  /**
   * Find campaign leads matching LinkedIn URL
   * @param {string} tenantId - Tenant ID
   * @param {string} normalizedLinkedInUrl - Normalized LinkedIn URL
   * @param {Object} context - Request context
   * @returns {Promise<Array>} Matching campaign leads
   */
  async findCampaignLeadsByLinkedInUrl(tenantId, normalizedLinkedInUrl, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        cl.id as campaign_lead_id, 
        cl.campaign_id, 
        cl.lead_id, 
        cl.tenant_id,
        cl.lead_data,
        cl.status as lead_status
      FROM ${schema}.campaign_leads cl
      WHERE cl.tenant_id = $1
        AND cl.is_deleted = false
        AND (
          cl.lead_data->>'linkedinUrl' = $2
          OR cl.lead_data->>'linkedin_url' = $2
          OR cl.lead_data->>'employee_linkedin_url' = $2
        )
        AND cl.status != 'completed'
    `;
    
    const result = await pool.query(query, [tenantId, normalizedLinkedInUrl]);
    return result.rows;
  }

  /**
   * Check if connection acceptance already recorded
   * @param {string} tenantId - Tenant ID
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} True if already exists
   */
  async hasConnectionAcceptanceRecord(tenantId, campaignId, leadId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT ca.id 
      FROM ${schema}.campaign_analytics ca
      WHERE ca.tenant_id = $1
        AND ca.campaign_id = $2
        AND ca.lead_id = $3
        AND ca.action_type = 'CONNECTION_ACCEPTED'
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tenantId, campaignId, leadId]);
    return result.rows.length > 0;
  }

  /**
   * Get connection sent record by LinkedIn URL
   * Searches campaign_analytics for CONNECTION_SENT matching lead_linkedin column
   * @param {string} tenantId - Tenant ID
   * @param {string} linkedInUrl - Normalized LinkedIn URL
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Sent record with lead info
   */
  async getConnectionSentRecordByLinkedInUrl(tenantId, linkedInUrl, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        ca.id,
        ca.campaign_id,
        ca.lead_id,
        ca.account_name,
        ca.provider_account_id,
        ca.lead_linkedin,
        ca.tenant_id,
        ca.response_data,
        ca.created_at as sent_at
      FROM ${schema}.campaign_analytics ca
      WHERE ca.tenant_id = $1
        AND ca.action_type = 'CONNECTION_SENT'
        AND ca.status = 'success'
        AND ca.lead_linkedin = $2
      ORDER BY ca.created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tenantId, linkedInUrl]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * DEPRECATED: Use getConnectionSentRecordByLinkedInUrl instead
   */
  async getConnectionSentRecordByRecipient(tenantId, recipientProviderId, linkedInUrl, context = {}) {
    // Just use the LinkedIn URL directly
    if (linkedInUrl) {
      return this.getConnectionSentRecordByLinkedInUrl(tenantId, linkedInUrl, context);
    }
    return null;
  }

  /**
   * Check if connection request was sent to this lead
   * @param {string} tenantId - Tenant ID
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Connection sent record with account info
   */
  async getConnectionSentRecord(tenantId, campaignId, leadId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        ca.id,
        ca.account_name,
        ca.provider_account_id,
        ca.lead_linkedin,
        ca.created_at as sent_at
      FROM ${schema}.campaign_analytics ca
      WHERE ca.tenant_id = $1
        AND ca.campaign_id = $2
        AND ca.lead_id = $3
        AND ca.action_type = 'CONNECTION_SENT'
        AND ca.status = 'success'
      ORDER BY ca.created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tenantId, campaignId, leadId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update campaign lead status
   * @param {string} campaignLeadId - Campaign lead ID (can be lead_id or actual campaign_lead ID)
   * @param {string} tenantId - Tenant ID
   * @param {string} newStatus - New status
   * @param {Object} context - Request context
   * @returns {Promise<void>}
   */
  async updateCampaignLeadStatus(campaignLeadId, tenantId, newStatus, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      UPDATE ${schema}.campaign_leads
      SET status = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND tenant_id = $3
        AND status = 'pending'
    `;
    
    await pool.query(query, [newStatus, campaignLeadId, tenantId]);
  }

  /**
   * Get LinkedIn account info by provider account ID
   * @param {string} providerAccountId - Unipile account ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Account info
   */
  async getLinkedInAccountByProviderId(providerAccountId, tenantId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT 
        id,
        tenant_id,
        account_name,
        provider_account_id
      FROM ${schema}.social_linkedin_accounts
      WHERE provider_account_id = $1
        AND tenant_id = $2
        AND is_deleted = false
      LIMIT 1
    `;
    
    const result = await pool.query(query, [providerAccountId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Check if lead is connected (has CONNECTION_ACCEPTED record)
   * @param {string} campaignLeadId - Campaign lead ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} True if connected
   */
  async isLeadConnected(campaignLeadId, tenantId, context = {}) {
    const schema = getSchema(context);
    
    // Get the lead_id from campaign_leads
    const leadQuery = `
      SELECT lead_id, campaign_id 
      FROM ${schema}.campaign_leads
      WHERE id = $1 
        AND tenant_id = $2
    `;
    
    const leadResult = await pool.query(leadQuery, [campaignLeadId, tenantId]);
    
    if (leadResult.rows.length === 0) {
      return false;
    }
    
    const { lead_id, campaign_id } = leadResult.rows[0];
    
    // Check for CONNECTION_ACCEPTED record
    const connectionQuery = `
      SELECT id 
      FROM ${schema}.campaign_analytics
      WHERE tenant_id = $1
        AND campaign_id = $2
        AND lead_id = $3
        AND action_type = 'CONNECTION_ACCEPTED'
        AND status = 'success'
      LIMIT 1
    `;
    
    const connectionResult = await pool.query(connectionQuery, [tenantId, campaign_id, lead_id]);
    return connectionResult.rows.length > 0;
  }

  /**
   * Check if connection is accepted for a lead
   * Used by step executors to verify connection before sending messages
   * 
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} True if connection accepted
   */
  async isConnectionAccepted(campaignId, leadId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT id 
      FROM ${schema}.campaign_analytics
      WHERE campaign_id = $1
        AND lead_id = $2
        AND action_type = 'CONNECTION_ACCEPTED'
        AND status = 'success'
      LIMIT 1
    `;
    
    const result = await pool.query(query, [campaignId, leadId]);
    return result.rows.length > 0;
  }

  /**
   * Get skipped message record for a lead
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Skipped message record or null
   */
  async getSkippedMessage(campaignId, leadId, tenantId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT id, action_type, created_at
      FROM ${schema}.campaign_analytics
      WHERE campaign_id = $1
        AND lead_id = $2
        AND tenant_id = $3
        AND action_type = 'MESSAGE_SKIPPED'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [campaignId, leadId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get campaign by ID
   * @param {string} campaignId - Campaign ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Campaign or null
   */
  async getCampaign(campaignId, tenantId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT id, name, config, tenant_id
      FROM ${schema}.campaigns
      WHERE id = $1 AND tenant_id = $2
    `;
    
    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get campaign lead with lead details
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Campaign lead with lead details or null
   */
  async getCampaignLeadWithDetails(campaignId, leadId, tenantId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT cl.id, cl.lead_id, cl.campaign_id, cl.status,
             l.linkedin_url, l.company_name, l.title
      FROM ${schema}.campaign_leads cl
      LEFT JOIN ${schema}.leads l ON cl.lead_id = l.id
      WHERE cl.campaign_id = $1 
        AND cl.lead_id = $2 
        AND cl.tenant_id = $3
      LIMIT 1
    `;
    
    const result = await pool.query(query, [campaignId, leadId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get linkedin_message step for a campaign
   * @param {string} campaignId - Campaign ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Message step or null
   */
  async getLinkedInMessageStep(campaignId, context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT id, step_type, config, step_order
      FROM ${schema}.campaign_steps
      WHERE campaign_id = $1
        AND step_type = 'linkedin_message'
      ORDER BY step_order ASC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [campaignId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
}

module.exports = new LinkedInPollingRepository();
