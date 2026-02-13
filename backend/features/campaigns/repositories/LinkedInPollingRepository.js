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
   * Get tenant IDs that have active LinkedIn accounts
   * Used by scheduler to iterate through tenants in tenant-scoped manner
   * @param {Object} context - Request context
   * @returns {Promise<Array<string>>} Array of tenant IDs
   */
  async getTenantsWithActiveLinkedInAccounts(context = {}) {
    const schema = getSchema(context);
    
    const query = `
      SELECT DISTINCT tenant_id
      FROM ${schema}.social_linkedin_accounts
      WHERE provider = 'unipile'
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
      ORDER BY tenant_id
    `;
    
    const result = await pool.query(query);
    return result.rows.map(row => row.tenant_id);
  }

  /**
   * Get all active LinkedIn accounts for specific tenant
   * ARCHITECTURE: Always tenant-scoped with WHERE tenant_id = $1
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context with tenant info
   * @returns {Promise<Array>} LinkedIn accounts
   */
  async getActiveLinkedInAccounts(tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
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
  /**
   * Get CONNECTION_SENT record by LinkedIn URL
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} linkedInUrl - LinkedIn profile URL
   * @param {object} context - Request context
   * @returns {Promise<object|null>} CONNECTION_SENT record or null
   */
  async getConnectionSentRecordByLinkedInUrl(tenantId, linkedInUrl, context = {}) {
    const schema = getSchema(context);
    
    if (!linkedInUrl) {
      return null;
    }
    
    // Normalize the incoming URL: ensure https, remove trailing slash
    const normalizedUrl = linkedInUrl
      .replace('http://', 'https://')
      .replace(/\/$/, ''); // Remove trailing slash
    
    const query = `
      SELECT 
        ca.id,
        ca.campaign_id,
        ca.lead_id,
        ca.account_name,
        ca.provider_account_id,
        ca.user_id,
        ca.lead_linkedin,
        ca.tenant_id,
        ca.response_data,
        ca.created_at as sent_at
      FROM ${schema}.campaign_analytics ca
      WHERE ca.tenant_id = $1
        AND ca.action_type = 'CONNECTION_SENT'
        AND ca.status = 'success'
        AND (
          -- Normalize both URLs for comparison: replace http with https, remove trailing slashes, compare lowercase
          LOWER(TRIM(TRAILING '/' FROM REPLACE(ca.lead_linkedin, 'http://', 'https://'))) = 
          LOWER(TRIM(TRAILING '/' FROM $2))
        )
      ORDER BY ca.created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tenantId, normalizedUrl]);
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
}

module.exports = new LinkedInPollingRepository();
