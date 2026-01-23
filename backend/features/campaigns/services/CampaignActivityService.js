/**
 * Campaign Activity Service
 * Handles campaign lead activity creation and updates
 */
const { pool } = require('../../../shared/database/connection');
const { getChannelForStepType } = require('./StepValidators');
const logger = require('../../../core/utils/logger');
/**
 * Create activity record for a step execution
 */
async function createActivity(campaignId, tenantId, campaignLeadId, stepId, stepType, req = null) {
  if (!campaignLeadId || !stepId) {
    return null;
  }
  try {
    // Try with campaign_id first (TDD schema)
    const schema = tenantId ? process.env.DB_SCHEMA || 'lad_dev' : process.env.DB_SCHEMA || 'lad_dev';
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
      try {
        const schema = tenantId ? process.env.DB_SCHEMA || 'lad_dev' : process.env.DB_SCHEMA || 'lad_dev';
        const activityResult = await pool.query(
          `INSERT INTO ${schema}.campaign_lead_activities 
           (tenant_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
           VALUES ($1, $2, $3, $4, $5, 'sent', $6, CURRENT_TIMESTAMP)
           RETURNING id`,
          [tenantId, campaignLeadId, stepId, stepType, stepType, getChannelForStepType(stepType)]
        );
        return activityResult.rows[0].id;
      } catch (fallbackError) {
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
    const schema = process.env.DB_SCHEMA || 'lad_dev';
    await pool.query(
      `UPDATE ${schema}.campaign_lead_activities 
       SET status = $1, 
           error_message = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, errorMessage, activityId]
    );
  } catch (updateErr) {
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
    const schema = tenantId ? process.env.DB_SCHEMA || 'lad_dev' : process.env.DB_SCHEMA || 'lad_dev';
    await pool.query(
      `INSERT INTO ${schema}.campaign_lead_activities 
       (tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
       VALUES ($1, $2, $3, $4, 'lead_generation', 'lead_generation', $5, 'web', CURRENT_TIMESTAMP)`,
      [tenantId, campaignId, campaignLeadId, stepId, activityStatus]
    );
  } catch (activityErr) {
  }
}
module.exports = {
  createActivity,
  updateActivityStatus,
  createLeadGenerationActivity
};
