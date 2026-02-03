/**
 * Campaign Lead Repository
 * SQL queries only - no business logic
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { randomUUID } = require('crypto');
class CampaignLeadRepository {
  /**
   * Create a new campaign lead
   */
  static async create(leadData, tenantId, req = null) {
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
    const schema = getSchema(req);
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
      INSERT INTO ${schema}.campaign_leads (
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
  static async getById(leadId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT * FROM ${schema}.campaign_leads
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;
    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0];
  }
  /**
   * Get leads by campaign ID
   */
  static async getByCampaignId(campaignId, tenantId, filters = {}, req = null) {
    const schema = getSchema(req);
    const { status, limit = 100, offset = 0 } = filters;
    let query = `
      SELECT * FROM ${schema}.campaign_leads
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
  static async existsByApolloId(campaignId, tenantId, apolloPersonId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT id FROM ${schema}.campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      AND lead_data->>'apollo_person_id' = $3
    `;
    const result = await pool.query(query, [campaignId, tenantId, String(apolloPersonId)]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
  /**
   * Update campaign lead
   */
  static async update(leadId, tenantId, updates, req = null) {
    const schema = getSchema(req);
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
        values.push((key === 'snapshot' || key === 'lead_data') ? JSON.stringify(value) : value);
      }
    }
    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }
    setClause.push(`updated_at = CURRENT_TIMESTAMP`);
    const query = `
      UPDATE ${schema}.campaign_leads
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
  static async delete(leadId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      UPDATE ${schema}.campaign_leads
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
  static async getActiveLeadsForCampaign(campaignId, tenantId, limit = 10, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT * FROM ${schema}.campaign_leads
      WHERE campaign_id = $1 AND tenant_id = $2 AND status = 'active' AND is_deleted = FALSE
      ORDER BY created_at ASC
      LIMIT $3
    `;
    const result = await pool.query(query, [campaignId, tenantId, limit]);
    return result.rows;
  }
  /**
   * Get lead data
   */
  static async getLeadData(leadId, campaignId, tenantId, schema) {
    const query = `
      SELECT lead_data FROM ${schema}.campaign_leads
      WHERE id = $1 AND campaign_id = $2 AND tenant_id = $3 AND is_deleted = FALSE
    `;
    const result = await pool.query(query, [leadId, campaignId, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  }
  /**
   * Get lead by ID with campaign ID
   */
  static async getLeadById(leadId, campaignId, tenantId, schema) {
    const query = `
      SELECT cl.*, cl.lead_data as lead_data_full
      FROM ${schema}.campaign_leads cl
      WHERE cl.id = $1 AND cl.campaign_id = $2 AND cl.tenant_id = $3 AND cl.is_deleted = FALSE
    `;
    const result = await pool.query(query, [leadId, campaignId, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  }
  /**
   * Update lead_data JSONB field
   */
  static async updateLeadData(leadId, campaignId, tenantId, schema, updates) {
    const selectResult = await pool.query(
      `SELECT lead_data FROM ${schema}.campaign_leads 
       WHERE id = $1 AND campaign_id = $2 AND tenant_id = $3 AND is_deleted = FALSE`,
      [leadId, campaignId, tenantId]
    );
    if (selectResult.rows.length === 0) {
      throw new Error('Lead not found');
    }
    let currentLeadData = {};
    if (selectResult.rows[0].lead_data) {
      currentLeadData = typeof selectResult.rows[0].lead_data === 'string' 
        ? JSON.parse(selectResult.rows[0].lead_data)
        : selectResult.rows[0].lead_data;
    }
    const updatedLeadData = { ...currentLeadData, ...updates };
    await pool.query(
      `UPDATE ${schema}.campaign_leads 
       SET lead_data = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND campaign_id = $3 AND tenant_id = $4 AND is_deleted = FALSE`,
      [JSON.stringify(updatedLeadData), leadId, campaignId, tenantId]
    );
    return updatedLeadData;
  }
  /**
   * Bulk create leads
   */
  static async bulkCreate(campaignId, tenantId, leads, req = null) {
    const schema = getSchema(req);
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
    const query = `
      INSERT INTO ${schema}.campaign_leads (
        tenant_id, campaign_id, lead_id, snapshot, lead_data, status
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * Get all existing Apollo person IDs for a tenant
   * Used for duplicate prevention across all campaigns
   * @param {string} tenantId - Tenant ID
   * @param {Object} req - Request object (optional)
   * @returns {Set<string>} Set of existing apollo_person_ids
   */
  static async getExistingLeadIdsByTenant(tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT DISTINCT 
        lead_data->>'apollo_person_id' as apollo_person_id,
        lead_data->>'id' as lead_id
      FROM ${schema}.campaign_leads 
      WHERE tenant_id = $1 AND is_deleted = FALSE
        AND (lead_data->>'apollo_person_id' IS NOT NULL 
             OR lead_data->>'id' IS NOT NULL)
    `;
    
    try {
      const result = await pool.query(query, [tenantId]);
      const existingIds = new Set();
      for (const row of result.rows) {
        if (row.apollo_person_id) existingIds.add(row.apollo_person_id);
        if (row.lead_id) existingIds.add(row.lead_id);
      }
      return existingIds;
    } catch (error) {
      const logger = require('../../../core/utils/logger');
      logger.error('[CampaignLeadRepository.getExistingLeadIdsByTenant] Error', {
        tenantId,
        error: error.message
      });
      // Return empty set on error to prevent breaking lead generation
      return new Set();
    }
  }

  /**
   * Get lead info by ID for activity tracking
   * @param {string} leadId - Lead ID
   * @param {Object} req - Request object (optional)
   * @returns {Object|null} Lead info with tenant_id and campaign_id
   */
  static async getLeadInfoById(leadId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT tenant_id, campaign_id 
      FROM ${schema}.campaign_leads 
      WHERE id = $1
    `;
    
    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0] || null;
    } catch (error) {
      const logger = require('../../../core/utils/logger');
      logger.error('[CampaignLeadRepository.getLeadInfoById] Error', {
        leadId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Update lead with enriched data (email, LinkedIn URL)
   * Used after Apollo enrichment API reveals contact details
   * @param {string} leadId - Lead ID (from leads table)
   * @param {string} tenantId - Tenant ID
   * @param {Object} enrichedData - Enriched data { email, linkedin_url, first_name, last_name }
   * @param {Object} req - Request object (optional)
   * @returns {Object} Updated lead row
   */
  static async updateLeadEnrichmentData(leadId, tenantId, enrichedData, req = null) {
    const schema = getSchema(req);
    const { email, linkedin_url, first_name, last_name } = enrichedData;
    
    // Update the leads table
    const query = `
      UPDATE ${schema}.leads 
      SET 
        email = COALESCE($1, email),
        linkedin_url = COALESCE($2, linkedin_url),
        first_name = COALESCE($3, first_name),
        last_name = COALESCE($4, last_name),
        updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6
      RETURNING id, email, linkedin_url, first_name, last_name
    `;
    
    const result = await pool.query(query, [
      email || null,
      linkedin_url || null,
      first_name || null,
      last_name || null,
      leadId,
      tenantId
    ]);
    
    // Also update campaign_leads with enriched columns AND update snapshot with name
    // This ensures subsequent steps don't re-enrich the same lead
    if (linkedin_url || email || first_name || last_name) {
      try {
        // Build the full name for display
        const fullName = first_name && last_name 
          ? `${first_name} ${last_name}`.trim()
          : first_name || last_name || null;
        
        await pool.query(`
          UPDATE ${schema}.campaign_leads
          SET 
            enriched_email = COALESCE($1, enriched_email),
            enriched_linkedin_url = COALESCE($2, enriched_linkedin_url),
            enriched_at = NOW(),
            updated_at = NOW(),
            snapshot = CASE 
              WHEN $5::text IS NOT NULL OR $6::text IS NOT NULL THEN
                jsonb_set(
                  jsonb_set(
                    COALESCE(snapshot::jsonb, '{}'::jsonb),
                    '{first_name}', COALESCE(to_jsonb($5::text), snapshot::jsonb->'first_name')
                  ),
                  '{last_name}', COALESCE(to_jsonb($6::text), snapshot::jsonb->'last_name')
                )
              ELSE snapshot
            END
          WHERE lead_id = $3 AND tenant_id = $4 AND is_deleted = FALSE
        `, [
          email || null,
          linkedin_url || null,
          leadId,
          tenantId,
          first_name || null,
          last_name || null
        ]);
      } catch (updateErr) {
        // Log but don't fail - leads table update is the primary goal
        const logger = require('../../../core/utils/logger');
        logger.warn('[CampaignLeadRepository.updateLeadEnrichmentData] Failed to update campaign_leads', {
          error: updateErr.message,
          leadId
        });
      }
    }
    
    return result.rows[0];
  }
}
module.exports = CampaignLeadRepository;
