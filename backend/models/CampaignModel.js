/**
 * Campaign Model
 * Handles database operations for campaigns
 */

const { pool } = require('../../../shared/database/connection');

class CampaignModel {
  /**
   * Create a new campaign
   */
  static async create(campaignData, tenantId) {
    const {
      name,
      status = 'draft',
      createdBy,
      config = {}
    } = campaignData;

    // Per TDD: Use lad_dev schema and created_by_user_id
    const query = `
      INSERT INTO lad_dev.campaigns (
        tenant_id, name, status, created_by_user_id, config, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      tenantId,
      name,
      status,
      createdBy,
      JSON.stringify(config)
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get campaign by ID
   */
  static async getById(campaignId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaigns
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows[0];
  }

  /**
   * List all campaigns for a tenant
   */
  static async list(tenantId, filters = {}) {
    const { status, search, limit = 50, offset = 0 } = filters;

    let query = `
      SELECT 
        c.*,
        COUNT(DISTINCT cl.id) as leads_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'opened' THEN cla.id END) as opened_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'clicked' THEN cla.id END) as clicked_count
      // Per TDD: Use lad_dev schema
      FROM lad_dev.campaigns c
      LEFT JOIN lad_dev.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1
      LEFT JOIN lad_dev.campaign_lead_activities cla ON cl.id = cla.campaign_lead_id
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

    query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Update campaign
   */
  static async update(campaignId, tenantId, updates) {
    const allowedFields = ['name', 'status', 'config'];
    const setClause = [];
    const values = [campaignId, tenantId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        values.push(key === 'config' ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    // Per TDD: Use lad_dev schema
    const query = `
      UPDATE lad_dev.campaigns
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Soft delete campaign
   */
  static async delete(campaignId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      UPDATE lad_dev.campaigns
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
  static async getStats(tenantId) {
    const query = `
      SELECT
        COUNT(DISTINCT c.id) as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns,
        COUNT(DISTINCT cl.id) as total_leads,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as total_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as total_delivered,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as total_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as total_replied
      // Per TDD: Use lad_dev schema
      FROM lad_dev.campaigns c
      LEFT JOIN lad_dev.campaign_leads cl ON c.id = cl.campaign_id AND cl.tenant_id = $1
      LEFT JOIN lad_dev.campaign_lead_activities cla ON cl.id = cla.campaign_lead_id
      WHERE c.tenant_id = $1 AND c.is_deleted = FALSE
    `;

    const result = await pool.query(query, [tenantId]);
    return result.rows[0];
  }

  /**
   * Get running campaigns
   */
  static async getRunningCampaigns(tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaigns
      WHERE tenant_id = $1 AND status = 'running' AND is_deleted = FALSE
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [tenantId]);
    return result.rows;
  }
}

module.exports = CampaignModel;
