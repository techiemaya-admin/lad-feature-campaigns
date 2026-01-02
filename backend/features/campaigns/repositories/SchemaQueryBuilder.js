/**
 * Schema Query Builder
 * Helper for building dynamic SQL queries with schema compatibility checks
 */
const { hasColumn, hasTable } = require('../utils/schemaChecker');
const logger = require('../utils/logger');
class SchemaQueryBuilder {
  /**
   * Extract clean schema name
   */
  static extractSchemaName(schema) {
    return schema.includes('.') ? schema.split('.')[0] : schema.replace(/[^a-zA-Z0-9_]/g, '');
  }
  /**
   * Build WHERE clause with tenant filtering if available
   */
  static async buildTenantFilter(schemaName, tableName, tenantId, paramIndex = 1) {
    const hasTenantId = await hasColumn(schemaName, tableName, 'tenant_id');
    if (hasTenantId && tenantId) {
      return {
        clause: ` AND ${tableName.split('.').pop()}.tenant_id = $${paramIndex}`,
        params: [tenantId],
        paramIndex: paramIndex + 1
      };
    }
    return { clause: '', params: [], paramIndex };
  }
  /**
   * Build is_deleted filter if column exists
   */
  static async buildIsDeletedFilter(schemaName, tableName, tableAlias = null) {
    const hasIsDeleted = await hasColumn(schemaName, tableName, 'is_deleted');
    if (hasIsDeleted) {
      const prefix = tableAlias || tableName.split('.').pop();
      return ` AND ${prefix}.is_deleted = FALSE`;
    }
    return '';
  }
  /**
   * Check schema capabilities for campaign queries
   */
  static async checkCampaignSchemaCapabilities(schemaName) {
    return {
      campaigns: {
        hasTenantId: await hasColumn(schemaName, 'campaigns', 'tenant_id'),
        hasIsDeleted: await hasColumn(schemaName, 'campaigns', 'is_deleted')
      },
      campaignLeads: {
        hasTenantId: await hasColumn(schemaName, 'campaign_leads', 'tenant_id'),
        hasIsDeleted: await hasColumn(schemaName, 'campaign_leads', 'is_deleted')
      },
      hasActivitiesTable: await hasTable(schemaName, 'campaign_lead_activities')
    };
  }
  /**
   * Build stats query with dynamic schema compatibility
   */
  static async buildStatsQuery(schema, tenantId) {
    const schemaName = this.extractSchemaName(schema);
    logger.debug(`[SchemaQueryBuilder] Building stats query for schema: ${schema}, extracted: ${schemaName}`);
    const capabilities = await this.checkCampaignSchemaCapabilities(schemaName);
    let query = `
      SELECT
        COUNT(DISTINCT c.id) as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns,
        COUNT(DISTINCT cl.id) as total_leads`;
    const params = [];
    let paramIndex = 1;
    // Add activity counts only if activities table exists
    if (capabilities.hasActivitiesTable) {
      query += `,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as total_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as total_delivered,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as total_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as total_replied`;
    } else {
      query += `,
        0 as total_sent,
        0 as total_delivered,
        0 as total_connected,
        0 as total_replied`;
    }
    query += `
      FROM ${schema}.campaigns c
      LEFT JOIN ${schema}.campaign_leads cl ON c.id = cl.campaign_id`;
    // Add tenant filtering for campaign_leads if column exists
    if (capabilities.campaignLeads.hasTenantId && tenantId) {
      query += ` AND cl.tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    // Add is_deleted filter for campaign_leads if available
    if (capabilities.campaignLeads.hasIsDeleted) {
      query += ` AND cl.is_deleted = FALSE`;
    }
    // Join activities table if it exists
    if (capabilities.hasActivitiesTable) {
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
    if (capabilities.campaigns.hasTenantId && tenantId) {
      query += ` AND c.tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    // Add is_deleted filter if available
    if (capabilities.campaigns.hasIsDeleted) {
      query += ` AND c.is_deleted = FALSE`;
    }
    return {
      query,
      params,
      capabilities,
      schemaName
    };
  }
  /**
   * Build running campaigns query
   */
  static async buildRunningCampaignsQuery(schema, tenantId) {
    const schemaName = this.extractSchemaName(schema);
    logger.debug(`[SchemaQueryBuilder] Building running campaigns query for schema: ${schema}, extracted: ${schemaName}`);
    const hasCampaignTenantId = await hasColumn(schemaName, 'campaigns', 'tenant_id');
    const hasIsDeleted = await hasColumn(schemaName, 'campaigns', 'is_deleted');
    let query = `SELECT * FROM ${schema}.campaigns WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    // Add tenant filtering if column exists
    if (hasCampaignTenantId && tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(tenantId);
    }
    query += ` AND status = 'running'`;
    // Add is_deleted filter if available
    if (hasIsDeleted) {
      query += ` AND is_deleted = FALSE`;
    }
    query += ` ORDER BY created_at DESC`;
    return {
      query,
      params,
      capabilities: {
        hasCampaignTenantId,
        hasIsDeleted
      },
      schemaName
    };
  }
}
module.exports = SchemaQueryBuilder;
