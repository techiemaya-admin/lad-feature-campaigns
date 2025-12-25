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

    // Per TDD: Use lad_dev schema with snapshot JSONB (not individual columns)
    const snapshot = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      linkedin_url: linkedinUrl,
      company_name: companyName,
      title: title,
      phone: phone
    };
    
    const query = `
      INSERT INTO lad_dev.campaign_leads (
        tenant_id, campaign_id, lead_id, snapshot, lead_data, status,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      tenantId,
      campaignId,
      leadId,
      JSON.stringify(snapshot),
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
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaign_leads
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;

    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0];
  }

  /**
   * Get leads by campaign ID
   */
  static async getByCampaignId(campaignId, tenantId, filters = {}) {
    const { status, limit = 100, offset = 0 } = filters;

    // Per TDD: Use lad_dev schema
    let query = `
      SELECT * FROM lad_dev.campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
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
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT id FROM lad_dev.campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      AND lead_data->>'apollo_person_id' = $3
    `;

    const result = await pool.query(query, [campaignId, tenantId, String(apolloPersonId)]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update campaign lead
   */
  static async update(leadId, tenantId, updates) {
    // Per TDD: Use lad_dev schema, update snapshot JSONB or other direct columns
    const allowedFields = [
      'snapshot', 'lead_data', 'status',
      'current_step_order', 'started_at', 'completed_at', 'error_message'
    ];

    const setClause = [];
    const values = [leadId, tenantId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        // JSONB fields need to be stringified
        values.push((key === 'snapshot' || key === 'lead_data') ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    // Per TDD: Use lad_dev schema
    const query = `
      UPDATE lad_dev.campaign_leads
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete campaign lead
   */
  static async delete(leadId, tenantId) {
    // Per TDD: Use lad_dev schema (soft delete)
    const query = `
      UPDATE lad_dev.campaign_leads
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
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
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND status = 'active' AND is_deleted = FALSE
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
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT lead_data FROM lad_dev.campaign_leads
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
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
      const offset = index * 6;
      placeholders.push(
        `($${paramIndex + offset}, $${paramIndex + offset + 1}, $${paramIndex + offset + 2}, $${paramIndex + offset + 3}, $${paramIndex + offset + 4}, $${paramIndex + offset + 5})`
      );

      // Per TDD: Build snapshot JSONB from individual fields
      const snapshot = {
        first_name: lead.firstName,
        last_name: lead.lastName,
        email: lead.email,
        linkedin_url: lead.linkedinUrl,
        company_name: lead.companyName,
        title: lead.title,
        phone: lead.phone
      };

      values.push(
        tenantId,
        campaignId,
        lead.leadId || randomUUID(),
        JSON.stringify(snapshot),
        JSON.stringify(lead.leadData || {}),
        lead.status || 'active'
      );
    });

    paramIndex += leads.length * 6;

    // Per TDD: Use lad_dev schema with snapshot JSONB
    const query = `
      INSERT INTO lad_dev.campaign_leads (
        tenant_id, campaign_id, lead_id, snapshot, lead_data, status
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = CampaignLeadModel;
