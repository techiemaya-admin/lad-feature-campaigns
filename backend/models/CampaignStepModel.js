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

    const query = `
      INSERT INTO campaign_steps (
        tenant_id, campaign_id, type, "order", title, description, config, created_at, updated_at
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
    const query = `
      SELECT * FROM campaign_steps
      WHERE campaign_id = $1 AND tenant_id = $2
      ORDER BY "order" ASC
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows;
  }

  /**
   * Get step by ID
   */
  static async getById(stepId, tenantId) {
    const query = `
      SELECT * FROM campaign_steps
      WHERE id = $1 AND tenant_id = $2
    `;

    const result = await pool.query(query, [stepId, tenantId]);
    return result.rows[0];
  }

  /**
   * Update campaign step
   */
  static async update(stepId, tenantId, updates) {
    const allowedFields = ['type', 'order', 'title', 'description', 'config'];
    const setClause = [];
    const values = [stepId, tenantId];
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

    const query = `
      UPDATE campaign_steps
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
    const query = `
      DELETE FROM campaign_steps
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
    const query = `
      DELETE FROM campaign_steps
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

    const query = `
      INSERT INTO campaign_steps (
        tenant_id, campaign_id, type, "order", title, description, config
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = CampaignStepModel;
