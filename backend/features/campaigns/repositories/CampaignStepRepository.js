/**
 * Campaign Step Repository
 * SQL queries only - no business logic
 */

const { getSchema } = require('../../../core/utils/schemaHelper');
const { pool } = require('../utils/dbConnection');
const logger = require('../../../core/utils/logger');

class CampaignStepRepository {
  /**
   * Create a new campaign step
   */
  static async create(stepData, tenantId, req = null) {
    const schema = getSchema(req);
    const {
      campaignId,
      type,
      order,
      title,
      description = '',
      config = {}
    } = stepData;

    const query = `
      INSERT INTO ${schema}.campaign_steps (
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
  static async getStepsByCampaignId(campaignId, tenantId, req = null) {
    const schema = getSchema(req);
    let query = `
      SELECT 
        id, tenant_id, campaign_id,
        step_type as type,
        step_order as "order",
        title, description, config,
        is_deleted, created_at, updated_at
      FROM ${schema}.campaign_steps
      WHERE campaign_id = $1 AND tenant_id = $2
      ORDER BY step_order ASC
    `;

    try {
      const result = await pool.query(query, [campaignId, tenantId]);
      return result.rows;
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('column "step_type"') || errorMsg.includes('column "step_order"')) {
        logger.warn('[CampaignStepRepository] step_type/step_order columns not found, trying type/order:', error.message);
        query = `
          SELECT 
            id, tenant_id, campaign_id,
            type,
            "order",
            title, description, config,
            is_deleted, created_at, updated_at
          FROM ${schema}.campaign_steps
          WHERE campaign_id = $1 AND tenant_id = $2
          ORDER BY "order" ASC
        `;
        try {
          const result = await pool.query(query, [campaignId, tenantId]);
          return result.rows;
        } catch (fallbackError) {
          const fallbackErrorMsg = fallbackError.message?.toLowerCase() || '';
          if (fallbackErrorMsg.includes('column "is_deleted"')) {
            logger.warn('[CampaignStepRepository] is_deleted column not found, trying without it:', fallbackError.message);
            query = `
              SELECT 
                id, tenant_id, campaign_id,
                type,
                "order",
                title, description, config,
                created_at, updated_at
              FROM ${schema}.campaign_steps
              WHERE campaign_id = $1 AND tenant_id = $2
              ORDER BY "order" ASC
            `;
            const result = await pool.query(query, [campaignId, tenantId]);
            return result.rows;
          }
          throw fallbackError;
        }
      } else if (errorMsg.includes('column "is_deleted"')) {
        logger.warn('[CampaignStepRepository] is_deleted column not found, trying without it:', error.message);
        query = `
          SELECT 
            id, tenant_id, campaign_id,
            step_type as type,
            step_order as "order",
            title, description, config,
            created_at, updated_at
          FROM ${schema}.campaign_steps
          WHERE campaign_id = $1 AND tenant_id = $2
          ORDER BY step_order ASC
        `;
        try {
          const result = await pool.query(query, [campaignId, tenantId]);
          return result.rows;
        } catch (fallbackError) {
          const fallbackErrorMsg = fallbackError.message?.toLowerCase() || '';
          if (fallbackErrorMsg.includes('column "step_type"') || fallbackErrorMsg.includes('column "step_order"')) {
            logger.warn('[CampaignStepRepository] step_type/step_order also not found, trying type/order:', fallbackError.message);
            query = `
              SELECT 
                id, tenant_id, campaign_id,
                type,
                "order",
                title, description, config,
                created_at, updated_at
              FROM ${schema}.campaign_steps
              WHERE campaign_id = $1 AND tenant_id = $2
              ORDER BY "order" ASC
            `;
            const result = await pool.query(query, [campaignId, tenantId]);
            return result.rows;
          }
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  /**
   * Get step by ID
   */
  static async getById(stepId, tenantId, req = null) {
    const schema = getSchema(req);
    let query = `
      SELECT 
        id, tenant_id, campaign_id,
        step_type as type,
        step_order as "order",
        title, description, config,
        is_deleted, created_at, updated_at
      FROM ${schema}.campaign_steps
      WHERE id = $1 AND tenant_id = $2
    `;

    try {
      const result = await pool.query(query, [stepId, tenantId]);
      return result.rows[0];
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('column "step_type"') || errorMsg.includes('column "step_order"')) {
        logger.warn('[CampaignStepRepository] step_type/step_order columns not found, trying type/order:', error.message);
        query = `
          SELECT 
            id, tenant_id, campaign_id,
            type,
            "order",
            title, description, config,
            is_deleted, created_at, updated_at
          FROM ${schema}.campaign_steps
          WHERE id = $1 AND tenant_id = $2
        `;
        try {
          const result = await pool.query(query, [stepId, tenantId]);
          return result.rows[0];
        } catch (fallbackError) {
          const fallbackErrorMsg = fallbackError.message?.toLowerCase() || '';
          if (fallbackErrorMsg.includes('column "is_deleted"')) {
            logger.warn('[CampaignStepRepository] is_deleted column not found, trying without it:', fallbackError.message);
            query = `
              SELECT 
                id, tenant_id, campaign_id,
                type,
                "order",
                title, description, config,
                created_at, updated_at
              FROM ${schema}.campaign_steps
              WHERE id = $1 AND tenant_id = $2
            `;
            const result = await pool.query(query, [stepId, tenantId]);
            return result.rows[0];
          }
          throw fallbackError;
        }
      } else if (errorMsg.includes('column "is_deleted"')) {
        logger.warn('[CampaignStepRepository] is_deleted column not found, trying without it:', error.message);
        query = `
          SELECT 
            id, tenant_id, campaign_id,
            step_type as type,
            step_order as "order",
            title, description, config,
            created_at, updated_at
          FROM ${schema}.campaign_steps
          WHERE id = $1 AND tenant_id = $2
        `;
        try {
          const result = await pool.query(query, [stepId, tenantId]);
          return result.rows[0];
        } catch (fallbackError) {
          const fallbackErrorMsg = fallbackError.message?.toLowerCase() || '';
          if (fallbackErrorMsg.includes('column "step_type"') || fallbackErrorMsg.includes('column "step_order"')) {
            logger.warn('[CampaignStepRepository] step_type/step_order also not found, trying type/order:', fallbackError.message);
            query = `
              SELECT 
                id, tenant_id, campaign_id,
                type,
                "order",
                title, description, config,
                created_at, updated_at
              FROM ${schema}.campaign_steps
              WHERE id = $1 AND tenant_id = $2
            `;
            const result = await pool.query(query, [stepId, tenantId]);
            return result.rows[0];
          }
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  /**
   * Update campaign step
   */
  static async update(stepId, tenantId, updates, req = null) {
    const schema = getSchema(req);
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

    const query = `
      UPDATE ${schema}.campaign_steps
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
  static async delete(stepId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      DELETE FROM ${schema}.campaign_steps
      WHERE id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [stepId, tenantId]);
    return result.rows[0];
  }

  /**
   * Delete all steps for a campaign
   */
  static async deleteByCampaignId(campaignId, tenantId, req = null) {
    const schema = getSchema(req);
    const query = `
      DELETE FROM ${schema}.campaign_steps
      WHERE campaign_id = $1 AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows;
  }

  /**
   * Bulk create steps
   */
  static async bulkCreate(campaignId, tenantId, steps, req = null) {
    const schema = getSchema(req);
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
      INSERT INTO ${schema}.campaign_steps (
        tenant_id, campaign_id, step_type, step_order, title, description, config
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    try {
      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      
      if (errorMsg.includes('column "step_type"') || errorMsg.includes('column "step_order"')) {
        logger.warn('[CampaignStepRepository] step_type/step_order columns not found, trying type/order:', error.message);
        
        const fallbackValues = [];
        const fallbackPlaceholders = [];
        let fallbackParamIndex = 1;
        
        steps.forEach((step, index) => {
          const offset = index * 7;
          fallbackPlaceholders.push(
            `($${fallbackParamIndex + offset}, $${fallbackParamIndex + offset + 1}, $${fallbackParamIndex + offset + 2}, $${fallbackParamIndex + offset + 3}, $${fallbackParamIndex + offset + 4}, $${fallbackParamIndex + offset + 5}, $${fallbackParamIndex + offset + 6})`
          );
          
          fallbackValues.push(
            tenantId,
            campaignId,
            step.type,
            step.order,
            step.title,
            step.description || '',
            JSON.stringify(step.config || {})
          );
        });
        
        const fallbackQuery = `
          INSERT INTO ${schema}.campaign_steps (
            tenant_id, campaign_id, type, "order", title, description, config
          )
          VALUES ${fallbackPlaceholders.join(', ')}
          RETURNING *
        `;
        
        try {
          const result = await pool.query(fallbackQuery, fallbackValues);
          return result.rows;
        } catch (fallbackError) {
          if (fallbackError.message && (fallbackError.message.includes('column "config"') || fallbackError.message.includes('jsonb'))) {
            logger.warn('[CampaignStepRepository] Config column also not found, trying without config:', fallbackError.message);
            
            const simpleValues = [];
            const simplePlaceholders = [];
            let simpleParamIndex = 1;
            
            steps.forEach((step, index) => {
              const offset = index * 6;
              simplePlaceholders.push(
                `($${simpleParamIndex + offset}, $${simpleParamIndex + offset + 1}, $${simpleParamIndex + offset + 2}, $${simpleParamIndex + offset + 3}, $${simpleParamIndex + offset + 4}, $${simpleParamIndex + offset + 5})`
              );
              
              simpleValues.push(
                tenantId,
                campaignId,
                step.type,
                step.order,
                step.title,
                step.description || ''
              );
            });
            
            const simpleQuery = `
              INSERT INTO ${schema}.campaign_steps (
                tenant_id, campaign_id, type, "order", title, description
              )
              VALUES ${simplePlaceholders.join(', ')}
              RETURNING *
            `;
            
            const result = await pool.query(simpleQuery, simpleValues);
            return result.rows;
          }
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }
}

module.exports = CampaignStepRepository;

