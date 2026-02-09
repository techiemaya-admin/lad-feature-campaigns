/**
 * Campaign Model
 * Handles database operations for campaigns
 */

// Use helper to resolve database connection path for both local and production
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
class CampaignModel {
  /**
   * Create a new campaign
   */
  static async create(campaignData, tenantId, req = null) {
    const {
      name,
      status = 'draft',
      createdBy,
      config = {},
      inbound_lead_ids,
      campaign_start_date,
      campaign_end_date,
      campaign_duration_days,
      working_days
    } = campaignData;
    const schema = getSchema(req);
    let campaign = null;
    
    // Calculate campaign_duration_days if not provided but dates are
    let durationDays = campaign_duration_days;
    if (!durationDays && campaign_start_date && campaign_end_date) {
      const start = new Date(campaign_start_date);
      const end = new Date(campaign_end_date);
      durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }
    
    // Try different INSERT queries based on database schema
    // Use created_by (correct column name) first, then fallback to created_by_user_id
    const queries = [
      {
        name: 'created_by with config and schedule',
        query: `INSERT INTO ${schema}.campaigns (
          tenant_id, name, status, created_by, config, 
          campaign_start_date, campaign_end_date, campaign_duration_days,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
        RETURNING *`,
        values: [tenantId, name, status, createdBy, JSON.stringify(config), 
                 campaign_start_date || null, campaign_end_date || null, durationDays || null]
      },
      {
        name: 'created_by with config',
        query: `INSERT INTO ${schema}.campaigns (tenant_id, name, status, created_by, config, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        values: [tenantId, name, status, createdBy, JSON.stringify(config)]
      },
      {
        name: 'created_by without config',
        query: `INSERT INTO ${schema}.campaigns (tenant_id, name, status, created_by, created_at, updated_at)
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        values: [tenantId, name, status, createdBy]
      },
      {
        name: 'created_by_user_id with config',
        query: `INSERT INTO ${schema}.campaigns (tenant_id, name, status, created_by_user_id, config, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        values: [tenantId, name, status, createdBy, JSON.stringify(config)]
      }
    ];
    // Try each query until one succeeds
    for (const q of queries) {
      try {
        const result = await pool.query(q.query, q.values);
        campaign = result.rows[0];
        break;
      } catch (error) {
        // Continue to next query
      }
    }
    if (!campaign) {
      throw new Error('Failed to create campaign with all available query patterns');
    }
    // Link inbound leads if provided (AFTER campaign is successfully created)
    if (inbound_lead_ids && Array.isArray(inbound_lead_ids) && inbound_lead_ids.length > 0) {
      try {
        for (const leadId of inbound_lead_ids) {
          // First, get the lead's tenant_id from the leads table
          // The FK constraint requires: (tenant_id, lead_id) to match (tenant_id, id) in leads table
          const leadResult = await pool.query(
            `SELECT tenant_id FROM ${schema}.leads WHERE id = $1`,
            [leadId]
          );
          if (leadResult.rows.length === 0) {
            continue;
          }
          const leadTenantId = leadResult.rows[0].tenant_id;
          // Insert with the lead's tenant_id to satisfy the FK constraint
          await pool.query(
            `INSERT INTO ${schema}.campaign_leads (
              campaign_id, tenant_id, lead_id, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [campaign.id, leadTenantId, leadId, 'pending']
          );
        }
      } catch (linkError) {
        // Don't throw - campaign is created, just logging the link failure
      }
    }
    return campaign;
  }
  /**
   * Get campaign by ID
   */
  static async getById(campaignId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT * FROM ${schema}.campaigns
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;
    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows[0];
  }
  /**
   * List all campaigns for a tenant
   */
  static async list(tenantId, filters = {}, req = null) {
    const { status, search, limit = 50, offset = 0 } = filters;
    const schema = getSchema(req);
    let query = `
      SELECT 
        c.id, c.tenant_id, c.name, c.status, c.created_by, c.config, c.metadata,
        c.campaign_start_date, c.campaign_end_date, c.campaign_duration_days,
        c.created_at, c.updated_at, c.is_deleted,
        COUNT(DISTINCT cl.id) as leads_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'opened' THEN cla.id END) as opened_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'clicked' THEN cla.id END) as clicked_count
      FROM ${schema}.campaigns c
      LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1 AND COALESCE(cl.is_deleted, FALSE) = FALSE
      LEFT JOIN ${schema}.campaign_lead_activities cla ON cl.id = cla.campaign_lead_id AND cla.tenant_id = $1 AND COALESCE(cla.is_deleted, FALSE) = FALSE
      WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
    `;
    const params = [tenantId];
    let paramIndex = 2;
    if (status && status !== 'all') {
      query += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }
    if (search) {
      query += ` AND c.name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }
    query += ` GROUP BY c.id, c.tenant_id, c.name, c.status, c.created_by, c.config, c.metadata, c.campaign_start_date, c.campaign_end_date, c.campaign_duration_days, c.created_at, c.updated_at, c.is_deleted ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      // If activities table doesn't exist, fallback to simpler query
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('campaign_lead_activities') || errorMsg.includes('does not exist') || errorMsg.includes('relation') || errorMsg.includes('undefined table')) {
        let fallbackQuery = `
          SELECT 
            c.id, c.tenant_id, c.name, c.status, c.created_by, c.config, c.metadata,
            c.campaign_start_date, c.campaign_end_date, c.campaign_duration_days,
            c.created_at, c.updated_at, c.is_deleted,
            COUNT(DISTINCT cl.id) as leads_count,
            0 as sent_count,
            0 as delivered_count,
            0 as connected_count,
            0 as replied_count,
            0 as opened_count,
            0 as clicked_count
          FROM ${schema}.campaigns c
          LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1 AND COALESCE(cl.is_deleted, FALSE) = FALSE
          WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
        `;
        const fallbackParams = [tenantId];
        let fallbackParamIndex = 2;
        if (status && status !== 'all') {
          fallbackQuery += ` AND c.status = $${fallbackParamIndex++}`;
          fallbackParams.push(status);
        }
        if (search) {
          fallbackQuery += ` AND c.name ILIKE $${fallbackParamIndex++}`;
          fallbackParams.push(`%${search}%`);
        }
        fallbackQuery += ` GROUP BY c.id, c.tenant_id, c.name, c.status, c.created_by, c.config, c.metadata, c.campaign_start_date, c.campaign_end_date, c.campaign_duration_days, c.created_at, c.updated_at, c.is_deleted ORDER BY c.created_at DESC LIMIT $${fallbackParamIndex++} OFFSET $${fallbackParamIndex++}`;
        fallbackParams.push(limit, offset);
        try {
          const result = await pool.query(fallbackQuery, fallbackParams);
          return result.rows;
        } catch (fallbackError) {
          // If cl.is_deleted doesn't exist, try without it (already removed above)
          // If there's still an error, it might be another column issue
          const fallbackErrorMsg = fallbackError.message?.toLowerCase() || '';
          if (fallbackErrorMsg.includes('is_deleted') || fallbackErrorMsg.includes('column') && fallbackErrorMsg.includes('does not exist')) {
            // The query already doesn't have cl.is_deleted, so if it still fails, return empty or try even simpler
            let simpleQuery = `
              SELECT 
                c.*,
                0 as leads_count,
                0 as sent_count,
                0 as delivered_count,
                0 as connected_count,
                0 as replied_count,
                0 as opened_count,
                0 as clicked_count
              FROM ${schema}.campaigns c
              WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
            `;
            const simpleParams = [tenantId];
            let simpleParamIndex = 2;
            if (status && status !== 'all') {
              simpleQuery += ` AND c.status = $${simpleParamIndex++}`;
              simpleParams.push(status);
            }
            if (search) {
              simpleQuery += ` AND c.name ILIKE $${simpleParamIndex++}`;
              simpleParams.push(`%${search}%`);
            }
            simpleQuery += ` ORDER BY c.created_at DESC LIMIT $${simpleParamIndex++} OFFSET $${simpleParamIndex++}`;
            simpleParams.push(limit, offset);
            const result = await pool.query(simpleQuery, simpleParams);
            return result.rows;
          }
          throw fallbackError;
        }
      }
      throw error;
    }
  }
  /**
   * Update campaign
   */
  static async update(campaignId, tenantId, updates, req = null) {
    const schema = getSchema(req);
    const allowedFields = ['name', 'status', 'config', 'execution_state', 'last_lead_check_at', 'next_run_at', 'last_execution_reason'];
    const setClause = [];
    const values = [campaignId, tenantId];
    let paramIndex = 3;
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === 'config') {
          // Merge config with existing config instead of replacing
          setClause.push(`${key} = COALESCE(${key}, '{}'::jsonb) || $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(value));
        } else if (key === 'last_lead_check_at' || key === 'next_run_at') {
          // Handle timestamp fields
          if (value === null) {
            setClause.push(`${key} = NULL`);
          } else {
            setClause.push(`${key} = $${paramIndex++}`);
            values.push(value);
          }
        } else {
          setClause.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }
    }
    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }
    setClause.push(`updated_at = CURRENT_TIMESTAMP`);
    const query = `
      UPDATE ${schema}.campaigns
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0];
  }
  /**
   * Update campaign execution state (internal use, no tenant check)
   * Used by scheduled processor to update execution state
   */
  static async updateExecutionState(campaignId, executionState, options = {}, req = null) {
    const schema = getSchema(req);
    const { lastLeadCheckAt = null, nextRunAt = null, lastExecutionReason = null } = options;
    const setClause = [];
    const values = [campaignId];
    let paramIndex = 2;
    setClause.push(`execution_state = $${paramIndex++}`);
    values.push(executionState);
    if (lastLeadCheckAt !== undefined) {
      if (lastLeadCheckAt === null) {
        setClause.push(`last_lead_check_at = NULL`);
      } else {
        setClause.push(`last_lead_check_at = $${paramIndex++}`);
        values.push(lastLeadCheckAt);
      }
    }
    if (nextRunAt !== undefined) {
      if (nextRunAt === null) {
        setClause.push(`next_run_at = NULL`);
      } else {
        setClause.push(`next_run_at = $${paramIndex++}`);
        values.push(nextRunAt);
      }
    }
    if (lastExecutionReason !== undefined) {
      setClause.push(`last_execution_reason = $${paramIndex++}`);
      values.push(lastExecutionReason);
    }
    setClause.push(`updated_at = CURRENT_TIMESTAMP`);
    // No tenant check - this is for internal processor use
    const query = `
      UPDATE ${schema}.campaigns
      SET ${setClause.join(', ')}
      WHERE id = $1
      RETURNING id, execution_state, last_lead_check_at, next_run_at, last_execution_reason
    `;
    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      // If columns don't exist, try without them (graceful degradation)
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('execution_state') || errorMsg.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }
  /**
   * Soft delete campaign
   */
  static async delete(campaignId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      UPDATE ${schema}.campaigns
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;
    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows[0];
  }
  /**
   * Get campaign statistics
   */
  static async getStats(tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT
        COUNT(DISTINCT c.id) as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns,
        COUNT(DISTINCT cl.id) as total_leads,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as total_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as total_delivered,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as total_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as total_replied
      FROM ${schema}.campaigns c
      LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1
      LEFT JOIN ${schema}.campaign_lead_activities cla ON cl.id = cla.campaign_lead_id AND cla.tenant_id = $1
      WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
    `;
    try {
      const result = await pool.query(query, [tenantId]);
      return result.rows[0];
    } catch (error) {
      // If activities table doesn't exist, fallback to simpler query
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('campaign_lead_activities') || errorMsg.includes('does not exist') || errorMsg.includes('relation') || errorMsg.includes('undefined table')) {
        const fallbackQuery = `
          SELECT
            COUNT(DISTINCT c.id) as total_campaigns,
            COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns,
            COUNT(DISTINCT cl.id) as total_leads,
            0 as total_sent,
            0 as total_delivered,
            0 as total_connected,
            0 as total_replied
          FROM ${schema}.campaigns c
          LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1
          WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
        `;
        const result = await pool.query(fallbackQuery, [tenantId]);
        return result.rows[0];
      }
      throw error;
    }
  }
  /**
   * Get running campaigns
   */
  static async getRunningCampaigns(tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      SELECT * FROM ${schema}.campaigns
      WHERE tenant_id = $1 AND status = 'running' AND is_deleted = FALSE
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [tenantId]);
    return result.rows;
  }
}
module.exports = CampaignModel;
