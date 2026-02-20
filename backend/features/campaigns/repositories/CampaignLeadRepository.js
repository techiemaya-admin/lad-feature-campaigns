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

  /**
   * Find enriched leads from OTHER tenants by matching email, name, or Apollo person ID
   * Cross-tenant enrichment caching strategy:
   * STEP 1: Search OTHER tenants for enriched leads
   * STEP 2: If found, check current tenant's previous campaigns and filter out matches
   * STEP 3: Return only unmatched enriched leads (Apollo API will handle the rest)
   * 
   * @param {string} email - Email to search for
   * @param {string} name - Full name to search for
   * @param {string} companyName - Company name to search for
   * @param {string} apolloPersonId - Apollo person ID to search for
   * @param {string} currentTenantId - Current tenant ID to exclude
   * @returns {Array} Array of enriched leads from other tenants (filtered to exclude current tenant matches)
   */
  static async findEnrichedLeadFromOtherTenants(email, name, companyName, apolloPersonId, currentTenantId, req = null) {
    const logger = require('../../../core/utils/logger');
    const schema = getSchema(req);
    
    try {
      // STEP 1: Search OTHER tenants for enriched leads
      const otherTenantResults = await this._searchEnrichedLeads(
        schema,
        currentTenantId,
        email,
        name,
        companyName,
        apolloPersonId,
        false  // searchCurrentTenant = false (search OTHER tenants)
      );
      
      if (!otherTenantResults || otherTenantResults.length === 0) {
        logger.info('[CampaignLeadRepository] No enriched leads found in Database (will use Apollo API)', {
          email: email ? email.substring(0, 20) + '...' : null,
          name: name || null,
          companyName: companyName || null,
          currentTenantId: currentTenantId.substring(0, 8) + '...'
        });
        return [];
      }
      
      logger.info('[CampaignLeadRepository] Found enriched leads in Database (cross-tenant cache HIT)', {
        email: email ? email.substring(0, 20) + '...' : null,
        resultsFound: otherTenantResults.length,
        currentTenantId: currentTenantId.substring(0, 8) + '...'
      });
      
      // STEP 2: Check current tenant's previous campaigns and filter out matches
      const matchedLeads = [];
      const unmatchedLeads = [];
      
      for (const cachedLead of otherTenantResults) {
        const existingTenantLead = await this.checkIfTenantHasLead(
          cachedLead.enriched_email,
          cachedLead.snapshot?.first_name ? `${cachedLead.snapshot.first_name} ${cachedLead.snapshot.last_name || ''}`.trim() : null,
          cachedLead.snapshot?.company_name,
          currentTenantId,
          req
        );
        
        if (existingTenantLead) {
          // This lead already exists in current tenant - SKIP
          matchedLeads.push({
            cachedLead: cachedLead,
            existingLeadId: existingTenantLead.id,
            reason: 'already_exists_in_current_tenant'
          });
        } else {
          // This lead is NOT in current tenant - can be reused from cache
          unmatchedLeads.push(cachedLead);
        }
      }
      
      logger.info('[CampaignLeadRepository] Filtered cross-tenant enriched leads', {
        foundInOtherTenants: otherTenantResults.length,
        alreadyInCurrentTenant: matchedLeads.length,
        availableForReuse: unmatchedLeads.length,
        currentTenantId: currentTenantId.substring(0, 8) + '...'
      });
      
      // Return only unmatched leads (that can be reused)
      return unmatchedLeads;
    } catch (error) {
      logger.error('[CampaignLeadRepository] Error finding enriched leads from other tenants', {
        error: error.message,
        email: email ? email.substring(0, 20) + '...' : null
      });
      return [];
    }
  }

  /**
   * Helper method to search for enriched leads
   * @param {string} schema - Database schema
   * @param {string} currentTenantId - Current tenant ID
   * @param {string} email - Email to search
   * @param {string} name - Name to search
   * @param {string} companyName - Company name to search
   * @param {string} apolloPersonId - Apollo person ID to search
   * @param {boolean} searchCurrentTenant - Search current tenant (true) or other tenants (false)
   * @returns {Promise<Array>} Enriched leads found
   */
  static async _searchEnrichedLeads(schema, currentTenantId, email, name, companyName, apolloPersonId, searchCurrentTenant) {
    let query = `
      SELECT 
        id,
        tenant_id,
        lead_id,
        enriched_email,
        enriched_linkedin_url,
        snapshot,
        lead_data,
        enriched_at
      FROM ${schema}.campaign_leads
      WHERE 
        ${searchCurrentTenant ? `tenant_id = $1` : `tenant_id != $1`}
        AND is_deleted = FALSE
        AND enriched_email IS NOT NULL 
        AND enriched_linkedin_url IS NOT NULL
        AND enriched_at IS NOT NULL
        AND (
    `;
    
    const params = [currentTenantId];
    let paramIndex = 2;
    const conditions = [];
    
    // Priority 1: Search by Apollo person ID (most reliable unique identifier)
    if (apolloPersonId) {
      conditions.push(`lead_data->>'apollo_person_id' = $${paramIndex}`);
      params.push(String(apolloPersonId));
      paramIndex++;
    }
    
    // Priority 2: Search by exact email match
    if (email && email.trim()) {
      conditions.push(`enriched_email = $${paramIndex}`);
      params.push(email.toLowerCase().trim());
      paramIndex++;
    }
    
    // Priority 3: Search by first name (more lenient) + company
    if (name && name.trim() && companyName && companyName.trim()) {
      const firstName = name.split(' ')[0];
      conditions.push(`(
        snapshot->>'first_name' ILIKE $${paramIndex}
        AND snapshot->>'company_name' ILIKE $${paramIndex + 1}
      )`);
      params.push(`%${firstName}%`, `%${companyName}%`);
      paramIndex += 2;
    }
    
    if (conditions.length === 0) {
      return [];
    }
    
    query += conditions.join(' OR ');
    query += `)
      ORDER BY 
        CASE 
          WHEN lead_data->>'apollo_person_id' IS NOT NULL THEN 0  -- Prioritize Apollo ID matches
          WHEN enriched_email IS NOT NULL THEN 1                   -- Then email matches
          ELSE 2                                                    -- Then name/company matches
        END,
        enriched_at DESC
      LIMIT 5
    `;
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Check if current tenant already has a lead with matching email/name/company
   * Used to avoid duplicating leads across campaigns
   * @param {string} email - Email to check
   * @param {string} name - Name to check
   * @param {string} companyName - Company name to check
   * @param {string} tenantId - Tenant ID
   * @returns {Object|null} Existing lead or null
   */
  static async checkIfTenantHasLead(email, name, companyName, tenantId, req = null) {
    const logger = require('../../../core/utils/logger');
    const schema = getSchema(req);
    
    try {
      let query = `
        SELECT id, lead_id, enriched_email, enriched_linkedin_url
        FROM ${schema}.campaign_leads
        WHERE tenant_id = $1 AND is_deleted = FALSE AND (
      `;
      
      const params = [tenantId];
      let paramIndex = 2;
      const conditions = [];
      
      if (email && email.trim()) {
        conditions.push(`enriched_email = $${paramIndex}`);
        params.push(email.toLowerCase().trim());
        paramIndex++;
      }
      
      if (name && name.trim() && companyName && companyName.trim()) {
        const firstName = name.split(' ')[0];
        const lastName = name.split(' ')[name.split(' ').length - 1];
        conditions.push(`(
          (snapshot->>'first_name' ILIKE $${paramIndex} OR snapshot->>'last_name' ILIKE $${paramIndex + 1})
          AND snapshot->>'company_name' ILIKE $${paramIndex + 2}
        )`);
        params.push(`%${firstName}%`, `%${lastName}%`, `%${companyName}%`);
        paramIndex += 3;
      }
      
      if (conditions.length === 0) {
        return null;
      }
      
      query += conditions.join(' OR ');
      query += `) LIMIT 1`;
      
      const result = await pool.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('[CampaignLeadRepository] Error checking if tenant has lead', {
        error: error.message,
        email: email ? email.substring(0, 20) + '...' : null
      });
      return null;
    }
  }
}
module.exports = CampaignLeadRepository;
