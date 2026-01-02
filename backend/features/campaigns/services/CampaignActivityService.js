/**
 * Campaign Activity Service
 * Handles campaign lead activity creation and updates
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../utils/schema');
const { getChannelForStepType } = require('./StepValidators');
const logger = require('../utils/logger');

/**
 * Create activity record for a step execution
 */
async function createActivity(campaignId, tenantId, campaignLeadId, stepId, stepType, req = null) {
  if (!campaignLeadId || !stepId) {
    return null;
  }
  
  try {
    // Try with campaign_id first (TDD schema)
    const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
    const activityResult = await pool.query(
      `INSERT INTO ${schema}.campaign_lead_activities 
       (tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, CURRENT_TIMESTAMP)
       RETURNING id`,
      [tenantId, campaignId, campaignLeadId, stepId, stepType, stepType, getChannelForStepType(stepType)]
    );
    
    return activityResult.rows[0].id;
  } catch (insertError) {
    // Fallback: If campaign_id column doesn't exist, try without it
    if (insertError.message && insertError.message.includes('campaign_id')) {
      logger.warn('[Campaign Activity] campaign_id column not found, trying without it', { error: insertError.message });
      try {
        const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
        const activityResult = await pool.query(
          `INSERT INTO ${schema}.campaign_lead_activities 
           (tenant_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
           VALUES ($1, $2, $3, $4, $5, 'sent', $6, CURRENT_TIMESTAMP)
           RETURNING id`,
          [tenantId, campaignLeadId, stepId, stepType, stepType, getChannelForStepType(stepType)]
        );
        
        return activityResult.rows[0].id;
      } catch (fallbackError) {
        logger.error('[Campaign Activity] Failed to create activity record', { error: fallbackError.message, stack: fallbackError.stack });
        return null;
      }
    } else {
      throw insertError;
    }
  }
}

/**
 * Update activity status
 */
async function updateActivityStatus(activityId, status, errorMessage = null, req = null) {
  if (!activityId) {
    return;
  }
  
  try {
    const schema = getSchema(req);
    await pool.query(
      `UPDATE ${schema}.campaign_lead_activities 
       SET status = $1, 
           error_message = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, errorMessage, activityId]
    );
  } catch (updateErr) {
    logger.error('[Campaign Activity] Error updating activity status', { error: updateErr.message, stack: updateErr.stack, activityId });
  }
}

/**
 * Create lead generation activity record
 */
async function createLeadGenerationActivity(tenantId, campaignId, campaignLeadId, stepId, req = null) {
  if (!campaignLeadId || !stepId) {
    return;
  }
  
  try {
    const activityStatus = 'sent'; // Always 'sent' for lead generation (represents successful execution)
    const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
    await pool.query(
      `INSERT INTO ${schema}.campaign_lead_activities 
       (tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
       VALUES ($1, $2, $3, $4, 'lead_generation', 'lead_generation', $5, 'web', CURRENT_TIMESTAMP)`,
      [tenantId, campaignId, campaignLeadId, stepId, activityStatus]
    );
  } catch (activityErr) {
    logger.error('[Campaign Activity] Warning: Failed to create lead generation activity', { error: activityErr.message, stack: activityErr.stack });
  }
}

module.exports = {
  createActivity,
  updateActivityStatus,
  createLeadGenerationActivity
};

