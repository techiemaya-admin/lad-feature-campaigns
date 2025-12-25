/**
 * Campaign Step Model
 * Handles database operations for campaign steps (workflow builder)
 */

const { pool } = require('../../../shared/database/connection');

class CampaignStepModel {
  /**
   * Create a new campaign step
   */
  static async create(stepData, tenantId) {
    const {
      campaignId,
      type,
      order,
      title,
      description = '',
      config = {}
    } = stepData;

    // Per TDD: Use lad_dev schema, step_type and step_order columns
    const query = `
      INSERT INTO lad_dev.campaign_steps (
        tenant_id, campaign_id, step_type, step_order, title, description, config, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      tenantId,
      campaignId,
      type,
      order,
      title,
      description,
      JSON.stringify(config)
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get steps for a campaign
   */
  static async getStepsByCampaignId(campaignId, tenantId) {
    // Per TDD: Use lad_dev schema and step_order column, alias for compatibility
    const query = `
      SELECT 
        id, tenant_id, campaign_id,
        step_type as type,
        step_order as "order",
        title, description, config,
        is_deleted, created_at, updated_at
      FROM lad_dev.campaign_steps
      WHERE campaign_id = $1 AND tenant_id = $2
      ORDER BY step_order ASC
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows;
  }

  /**
   * Get step by ID
   */
  static async getById(stepId, tenantId) {
    // Per TDD: Use lad_dev schema, alias for compatibility
    const query = `
      SELECT 
        id, tenant_id, campaign_id,
        step_type as type,
        step_order as "order",
        title, description, config,
        is_deleted, created_at, updated_at
      FROM lad_dev.campaign_steps
      WHERE id = $1 AND tenant_id = $2
    `;

    const result = await pool.query(query, [stepId, tenantId]);
    return result.rows[0];
  }

  /**
   * Update campaign step
   */
  static async update(stepId, tenantId, updates) {
    // Per TDD: Map JavaScript field names to database column names
    const fieldMapping = {
      'type': 'step_type',
      'order': 'step_order',
      'title': 'title',
      'description': 'description',
      'config': 'config'
    };
    
    const allowedFields = ['type', 'order', 'title', 'description', 'config'];
    const setClause = [];
    const values = [stepId, tenantId];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        const dbColumn = fieldMapping[key] || key;
        setClause.push(`${dbColumn} = $${paramIndex++}`);
        values.push(key === 'config' ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    // Per TDD: Use lad_dev schema
    const query = `
      UPDATE lad_dev.campaign_steps
      SET ${setClause.join(', ')}
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete campaign step
   */
  static async delete(stepId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      DELETE FROM lad_dev.campaign_steps
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [stepId, tenantId]);
    return result.rows[0];
  }

  /**
   * Delete all steps for a campaign
   */
  static async deleteByCampaignId(campaignId, tenantId) {
    // Per TDD: Use lad_dev schema
    const query = `
      DELETE FROM lad_dev.campaign_steps
      WHERE campaign_id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows;
  }

  /**
   * Bulk create steps (for workflow builder)
   */
  static async bulkCreate(campaignId, tenantId, steps) {
    if (!steps || steps.length === 0) {
      return [];
    }

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    steps.forEach((step, index) => {
      const offset = index * 7;
      placeholders.push(
        `($${paramIndex + offset}, $${paramIndex + offset + 1}, $${paramIndex + offset + 2}, $${paramIndex + offset + 3}, $${paramIndex + offset + 4}, $${paramIndex + offset + 5}, $${paramIndex + offset + 6})`
      );

      values.push(
        tenantId,
        campaignId,
        step.type,
        step.order,
        step.title,
        step.description || '',
        JSON.stringify(step.config || {})
      );
    });

    paramIndex += steps.length * 7;

    // Per TDD: Use lad_dev schema, step_type and step_order columns
    const query = `
      INSERT INTO lad_dev.campaign_steps (
        tenant_id, campaign_id, step_type, step_order, title, description, config
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = CampaignStepModel;
