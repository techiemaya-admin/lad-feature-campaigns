/**
 * Campaign Lead Model
 * Handles database operations for campaign leads
 */

const { pool } = require('../../../shared/database/connection');
const { randomUUID } = require('crypto');

class CampaignLeadModel {
  /**
   * Create a new campaign lead
   */
  static async create(leadData, tenantId) {
    const {
      campaignId,
      leadId = randomUUID(),
      firstName,
      lastName,
      email,
      linkedinUrl,
      companyName,
      title,
      phone,
      leadData: customData = {},
      status = 'active'
    } = leadData;

    const query = `
      INSERT INTO campaign_leads (
        tenant_id, campaign_id, lead_id, first_name, last_name, email,
        linkedin_url, company_name, title, phone, lead_data, status,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      tenantId,
      campaignId,
      leadId,
      firstName,
      lastName,
      email,
      linkedinUrl,
      companyName,
      title,
      phone,
      JSON.stringify(customData),
      status
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get lead by ID
   */
  static async getById(leadId, tenantId) {
    const query = `
      SELECT * FROM campaign_leads
      WHERE id = $1 AND tenant_id = $2
    `;

    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0];
  }

  /**
   * Get leads by campaign ID
   */
  static async getByCampaignId(campaignId, tenantId, filters = {}) {
    const { status, limit = 100, offset = 0 } = filters;

    let query = `
      SELECT * FROM campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2
    `;

    const params = [campaignId, tenantId];
    let paramIndex = 3;

    if (status && status !== 'all') {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Check if lead exists by Apollo ID
   */
  static async existsByApolloId(campaignId, tenantId, apolloPersonId) {
    const query = `
      SELECT id FROM campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2
      AND lead_data->>'apollo_person_id' = $3
    `;

    const result = await pool.query(query, [campaignId, tenantId, String(apolloPersonId)]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update campaign lead
   */
  static async update(leadId, tenantId, updates) {
    const allowedFields = [
      'first_name', 'last_name', 'email', 'linkedin_url', 
      'company_name', 'title', 'phone', 'lead_data', 'status',
      'current_step_order', 'started_at', 'completed_at'
    ];

    const setClause = [];
    const values = [leadId, tenantId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        values.push(key === 'lead_data' ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE campaign_leads
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete campaign lead
   */
  static async delete(leadId, tenantId) {
    const query = `
      DELETE FROM campaign_leads
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0];
  }

  /**
   * Get active leads for processing
   */
  static async getActiveLeadsForCampaign(campaignId, tenantId, limit = 10) {
    const query = `
      SELECT * FROM campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND status = 'active'
      ORDER BY created_at ASC
      LIMIT $3
    `;

    const result = await pool.query(query, [campaignId, tenantId, limit]);
    return result.rows;
  }

  /**
   * Get lead data (handles both lead_data and custom_fields columns)
   */
  static async getLeadData(campaignLeadId, tenantId) {
    const query = `
      SELECT lead_data FROM campaign_leads
      WHERE id = $1 AND tenant_id = $2
    `;

    const result = await pool.query(query, [campaignLeadId, tenantId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const leadData = result.rows[0].lead_data;
    return typeof leadData === 'string' ? JSON.parse(leadData) : leadData;
  }

  /**
   * Bulk create leads
   */
  static async bulkCreate(campaignId, tenantId, leads) {
    if (!leads || leads.length === 0) {
      return [];
    }

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    leads.forEach((lead, index) => {
      const offset = index * 12;
      placeholders.push(
        `($${paramIndex + offset}, $${paramIndex + offset + 1}, $${paramIndex + offset + 2}, $${paramIndex + offset + 3}, $${paramIndex + offset + 4}, $${paramIndex + offset + 5}, $${paramIndex + offset + 6}, $${paramIndex + offset + 7}, $${paramIndex + offset + 8}, $${paramIndex + offset + 9}, $${paramIndex + offset + 10}, $${paramIndex + offset + 11})`
      );

      values.push(
        tenantId,
        campaignId,
        lead.leadId || randomUUID(),
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.linkedinUrl,
        lead.companyName,
        lead.title,
        lead.phone,
        JSON.stringify(lead.leadData || {}),
        lead.status || 'active'
      );
    });

    paramIndex += leads.length * 12;

    const query = `
      INSERT INTO campaign_leads (
        tenant_id, campaign_id, lead_id, first_name, last_name, email,
        linkedin_url, company_name, title, phone, lead_data, status
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = CampaignLeadModel;
