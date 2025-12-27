/**
 * Campaign Lead Activity Model
 * Handles database operations for campaign lead activities (tracking actions)
 */

const { pool } = require('../../../../shared/database/connection');

class CampaignLeadActivityModel {
  /**
   * Create a new activity
   */
  static async create(activityData) {
    const {
      tenantId,
      campaignId, // Required in TDD schema
      campaignLeadId,
      stepId,
      stepType,
      actionType,
      status = 'pending',
      channel,
      messageContent,
      subject,
      errorMessage,
      metadata = {},
      provider,
      providerEventId,
      executedAt
    } = activityData;

    // Per TDD: Use lad_dev schema with all required columns
    const query = `
      INSERT INTO lad_dev.campaign_lead_activities (
        tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status,
        channel, subject, message_content, error_message, metadata,
        provider, provider_event_id, executed_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      tenantId,
      campaignId,
      campaignLeadId,
      stepId,
      stepType,
      actionType,
      status,
      channel,
      subject || null,
      messageContent || null,
      errorMessage || null,
      JSON.stringify(metadata),
      provider || null,
      providerEventId || null,
      executedAt || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get activity by ID
   */
  static async getById(activityId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaign_lead_activities
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;

    const result = await pool.query(query, [activityId, tenantId]);
    return result.rows[0];
  }

  /**
   * Get activities by campaign lead ID
   */
  static async getByLeadId(campaignLeadId, tenantId, limit = 100) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaign_lead_activities
      WHERE campaign_lead_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const result = await pool.query(query, [campaignLeadId, tenantId, limit]);
    return result.rows;
  }

  /**
   * Get last successful activity for a lead
   */
  static async getLastSuccessfulActivity(campaignLeadId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT * FROM lad_dev.campaign_lead_activities
      WHERE campaign_lead_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      AND status IN ('delivered', 'connected', 'replied')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [campaignLeadId, tenantId]);
    return result.rows[0];
  }

  /**
   * Check if step was already executed for lead
   */
  static async stepAlreadyExecuted(campaignLeadId, stepId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT id, status FROM lad_dev.campaign_lead_activities
      WHERE campaign_lead_id = $1 AND step_id = $2 AND tenant_id = $3 AND is_deleted = FALSE
      AND status IN ('delivered', 'connected', 'replied')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [campaignLeadId, stepId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update activity
   */
  static async update(activityId, tenantId, updates) {
    // Per TDD: Use lad_dev schema, update allowed fields
    const allowedFields = [
      'status', 'error_message', 'metadata', 'message_content', 'subject',
      'provider', 'provider_event_id', 'executed_at'
    ];

    const setClause = [];
    const values = [activityId, tenantId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        // JSONB fields need to be stringified
        values.push(key === 'metadata' ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    // Per TDD: Use lad_dev schema
    const query = `
      UPDATE lad_dev.campaign_lead_activities
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get activities by campaign ID (for analytics)
   */
  static async getByCampaignId(campaignId, tenantId, filters = {}) {
    const { status, stepType, limit = 1000, offset = 0 } = filters;

    // Per TDD: Use lad_dev schema
    let query = `
      SELECT cla.* FROM lad_dev.campaign_lead_activities cla
      INNER JOIN lad_dev.campaign_leads cl ON cla.campaign_lead_id = cl.id
      WHERE cl.campaign_id = $1 AND cla.tenant_id = $2 AND cla.is_deleted = FALSE
    `;

    const params = [campaignId, tenantId];
    let paramIndex = 3;

    if (status) {
      query += ` AND cla.status = $${paramIndex++}`;
      params.push(status);
    }

    if (stepType) {
      query += ` AND cla.step_type = $${paramIndex++}`;
      params.push(stepType);
    }

    query += ` ORDER BY cla.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get activity stats for a campaign
   */
  static async getCampaignStats(campaignId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      SELECT
        COUNT(*) as total_activities,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN status = 'connected' THEN 1 END) as connected_count,
        COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied_count,
        COUNT(CASE WHEN status = 'opened' THEN 1 END) as opened_count,
        COUNT(CASE WHEN status = 'clicked' THEN 1 END) as clicked_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as error_count
      FROM lad_dev.campaign_lead_activities cla
      INNER JOIN lad_dev.campaign_leads cl ON cla.campaign_lead_id = cl.id
      WHERE cl.campaign_id = $1 AND cla.tenant_id = $2 AND cla.is_deleted = FALSE
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows[0];
  }

  /**
   * Delete activities by lead ID
   */
  static async deleteByLeadId(campaignLeadId, tenantId) {
    // Per TDD: Use lad_dev schema (soft delete)
    const query = `
      UPDATE lad_dev.campaign_lead_activities
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE campaign_lead_id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [campaignLeadId, tenantId]);
    return result.rows;
  }
}

module.exports = CampaignLeadActivityModel;
