/**
 * Campaign Repository
 * SQL queries only - no business logic
 */
const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { hasColumn, hasTable } = require('../utils/schemaChecker');
const SchemaQueryBuilder = require('./SchemaQueryBuilder');
const logger = require('../../../core/utils/logger');
class CampaignRepository {
  /**
   * Create a new campaign
   */
  static async create(campaignData, tenantId, req = null) {
    const {
      name,
      status = 'draft',
      createdBy,
      config = {}
    } = campaignData;
    const schema = getSchema(req);
    const query = `
      INSERT INTO ${schema}.campaigns (
        tenant_id, name, status, created_by_user_id, config, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const values = [
      tenantId,
      name,
      status,
      createdBy,
      JSON.stringify(config)
    ];
    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('created_by_user_id') && errorMsg.includes('does not exist')) {
        logger.warn('[CampaignRepository] created_by_user_id column not found, trying created_by:', error.message);
        try {
          const fallbackQuery = `
            INSERT INTO ${schema}.campaigns (
              tenant_id, name, status, created_by, config, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
          `;
          const result = await pool.query(fallbackQuery, values);
          return result.rows[0];
        } catch (fallbackError) {
          if (fallbackError.message && (fallbackError.message.includes('column "config"') || fallbackError.message.includes('jsonb'))) {
            logger.warn('[CampaignRepository] Config column also not found, trying without config:', fallbackError.message);
            const simpleQuery = `
              INSERT INTO ${schema}.campaigns (
                tenant_id, name, status, created_by, created_at, updated_at
              )
              VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              RETURNING *
            `;
            const simpleValues = [tenantId, name, status, createdBy];
            const result = await pool.query(simpleQuery, simpleValues);
            return result.rows[0];
          }
          throw fallbackError;
        }
      }
      if (errorMsg.includes('column "config"') || errorMsg.includes('jsonb')) {
        logger.warn('[CampaignRepository] Config column issue, trying insert without config:', error.message);
        const fallbackQuery = `
          INSERT INTO ${schema}.campaigns (
            tenant_id, name, status, created_by_user_id, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `;
        const fallbackValues = [tenantId, name, status, createdBy];
        try {
          const result = await pool.query(fallbackQuery, fallbackValues);
          return result.rows[0];
        } catch (fallbackError2) {
          if (fallbackError2.message && fallbackError2.message.includes('created_by_user_id')) {
            const simpleQuery = `
              INSERT INTO ${schema}.campaigns (
                tenant_id, name, status, created_by, created_at, updated_at
              )
              VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              RETURNING *
            `;
            const result = await pool.query(simpleQuery, fallbackValues);
            return result.rows[0];
          }
          throw fallbackError2;
        }
      }
      throw error;
    }
  }

  /**
   * Get campaign by ID (with dynamic schema compatibility)
   */
  static async getById(campaignId, tenantId, req = null) {
    const schema = getSchema(req);
    const schemaName = schema.includes('.') ? schema : schema.replace(/[^a-zA-Z0-9_]/g, '');
    // Debug log to verify schema name
    logger.debug('Campaign getById using schema', { schema, extracted: schemaName });
    const [hasTenantId, hasIsDeleted] = await Promise.all([
      hasColumn(schemaName, 'campaigns', 'tenant_id'),
      hasColumn(schemaName, 'campaigns', 'is_deleted')
    ]);
    let query = `SELECT * FROM ${schema}.campaigns WHERE id = $1`;
    const params = [campaignId];
    let paramIndex = 2;
    // Add tenant filtering if column exists
    if (hasTenantId && tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    
    // Add is_deleted filter if available
    if (hasIsDeleted) {
      query += ` AND is_deleted = FALSE`;
    }
    try {
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (error) {
      logger.error('[CampaignRepository] Error in getById query', {
        error: error.message,
        campaignId,
        tenantId,
        schema: schemaName,
        capabilities: { hasTenantId, hasIsDeleted }
      });
      throw error;
    }
  }

  /**
   * List all campaigns for a tenant (with dynamic schema compatibility)
   */
  static async list(tenantId, filters = {}, req = null) {
    const { status, search, limit = 50, offset = 0 } = filters;
    const schema = getSchema(req);
    // Extract schema name for column checking
    const schemaName = schema.includes('.') ? schema.split('.')[0] : schema.replace(/[^a-zA-Z0-9_]/g, '');
    // Debug log to verify schema name
    logger.debug(`[CampaignRepository] Using schema: ${schema}, extracted: ${schemaName}`);
    // Check schema capabilities once at the start
    const [hasCampaignTenantId, hasLeadTenantId, hasActivitiesTable, hasIsDeleted] = await Promise.all([
      hasColumn(schemaName, 'campaigns', 'tenant_id'),
      hasColumn(schemaName, 'campaign_leads', 'tenant_id'),  
      hasTable(schemaName, 'campaign_lead_activities'),
      hasColumn(schemaName, 'campaigns', 'is_deleted')
    ]);
    // Build query dynamically based on schema capabilities
    let query = `
      SELECT 
        c.*,
        COUNT(DISTINCT cl.id) as leads_count`;
    const params = [];
    let paramIndex = 1;
    // Add activity counts only if activities table exists
    if (hasActivitiesTable) {
      query += `,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'opened' THEN cla.id END) as opened_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'clicked' THEN cla.id END) as clicked_count`;
    } else {
      query += `,
        0 as sent_count,
        0 as delivered_count,
        0 as connected_count,
        0 as replied_count,
        0 as opened_count,
        0 as clicked_count`;
    }
    query += `
      FROM ${schema}.campaigns c
      LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id`;
    // Add tenant filtering for campaign_leads if column exists
    if (hasLeadTenantId && tenantId) {
      query += ` AND cl.tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    
    // Add is_deleted filter for campaign_leads if available
    const hasLeadIsDeleted = await hasColumn(schemaName, 'campaign_leads', 'is_deleted');
    if (hasLeadIsDeleted) {
      query += ` AND COALESCE(cl.is_deleted, FALSE) = FALSE`;
    }
    
    // Join activities table if it exists
    if (hasActivitiesTable) {
      query += `
      LEFT JOIN ${schema}.campaign_lead_activities cla ON cl.id = cla.campaign_lead_id`;
      const hasActivityTenantId = await hasColumn(schemaName, 'campaign_lead_activities', 'tenant_id');
      if (hasActivityTenantId && tenantId) {
        query += ` AND cla.tenant_id = $${paramIndex++}`;
        params.push(tenantId);
      }
    }
    
    // Add WHERE clause
    query += `
      WHERE 1=1`;
    // Add tenant filtering for campaigns if column exists
    if (hasCampaignTenantId && tenantId) {
      query += ` AND c.tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    
    // Add is_deleted filter if available
    if (hasIsDeleted) {
      query += ` AND c.is_deleted = FALSE`;
    }
    
    // Add status filter
    if (status && status !== 'all') {
      query += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }
    
    // Add search filter
    if (search) {
      query += ` AND c.name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }
    
    // Add grouping, ordering and pagination
    query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('[CampaignRepository] Error in list query', {
        error: error.message,
        query: query.replace(/\s+/g, ' ').trim(),
        params,
        schema: schemaName,
        capabilities: {
          hasCampaignTenantId,
          hasLeadTenantId,
          hasActivitiesTable,
          hasIsDeleted
        }
      });
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
          setClause.push(`${key} = $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(value));
        } else if (key === 'last_lead_check_at' || key === 'next_run_at') {
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
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('execution_state') || errorMsg.includes('does not exist')) {
        logger.warn('[CampaignRepository] Execution state columns not found, skipping update:', error.message);
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
    const { query, params, capabilities, schemaName } = await SchemaQueryBuilder.buildStatsQuery(schema, tenantId);
    try {
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (error) {
      logger.error('[CampaignRepository] Error in getStats query', {
        error: error.message,
        query: query.replace(/\s+/g, ' ').trim(),
        params,
        schema: schemaName,
        capabilities
      });
      throw error;
    }
  }
  /**
   * Get running campaigns (with dynamic schema compatibility)
   */
  static async getRunningCampaigns(tenantId, req = null) {
    const schema = getSchema(req);
    const { query, params, capabilities, schemaName } = await SchemaQueryBuilder.buildRunningCampaignsQuery(schema, tenantId);
    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('[CampaignRepository] Error in getRunningCampaigns query', {
        error: error.message,
        query: query.replace(/\s+/g, ' ').trim(),
        params,
        schema: schemaName,
        capabilities
      });
      throw error;
    }
  }
}

module.exports = CampaignRepository;
