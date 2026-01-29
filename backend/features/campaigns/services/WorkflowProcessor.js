/**
 * Workflow Processor
 * Handles processing leads through workflow steps
 * LAD Architecture Compliant - Uses logger instead of console
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { validateStepConfig } = require('./StepValidators');
// Lazy load executeStepForLead to avoid circular dependency with CampaignProcessor
// CampaignProcessor imports processLeadThroughWorkflow from this file,
// so we can't import executeStepForLead at the top level
let executeStepForLead = null;
const { executeConditionStep } = require('./StepExecutors');
/**
 * Process a lead through the workflow steps
 */
async function processLeadThroughWorkflow(campaign, steps, campaignLead, userId, tenantId, authToken = null) {
  try {
    // Find the last successfully completed step for this lead
    // This ensures we don't re-execute steps that were already completed
    // LAD Architecture: Get schema from tenant context
    const schema = getSchema({ user: { tenant_id: tenantId } });
    const lastSuccessfulActivityResult = await pool.query(
      `SELECT step_id, status, created_at FROM ${schema}.campaign_lead_activities 
       WHERE campaign_lead_id = $1 
       AND status IN ('delivered', 'connected', 'replied')
       ORDER BY created_at DESC LIMIT 1`,
      [campaignLead.id]
    );
    let nextStepIndex = 0;
    if (lastSuccessfulActivityResult.rows.length > 0) {
      const lastSuccessfulActivity = lastSuccessfulActivityResult.rows[0];
      const lastSuccessfulStepIndex = steps.findIndex(s => s.id === lastSuccessfulActivity.step_id);
      if (lastSuccessfulStepIndex >= 0) {
        // Advance to the step after the last successfully completed step
        nextStepIndex = lastSuccessfulStepIndex + 1;
      }
    } else {
      // No successful activities yet, start from the beginning
    }
    if (nextStepIndex >= steps.length) {
      // All steps completed, mark lead as completed
      // Per TDD: Use dynamic schema with tenant enforcement
      await pool.query(
        `UPDATE ${schema}.campaign_leads SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
        [campaignLead.id, tenantId]
      );
      return;
    }
    const nextStep = steps[nextStepIndex];
    // CRITICAL: Normalize step type - database uses step_type, but code expects type
    const nextStepType = nextStep.step_type || nextStep.type;
    // CRITICAL: Check if this step has already been successfully executed for this lead
    // This prevents duplicate execution of steps like "Visit LinkedIn Profile" or "Send Connection Request"
    // Per TDD: Use lad_dev schema
    const existingActivityResult = await pool.query(
      `SELECT id, status FROM ${schema}.campaign_lead_activities 
       WHERE campaign_lead_id = $1 
       AND step_id = $2 
       AND status IN ('delivered', 'connected', 'replied')
       ORDER BY created_at DESC LIMIT 1`,
      [campaignLead.id, nextStep.id]
    );
    if (existingActivityResult.rows.length > 0) {
      const existingActivity = existingActivityResult.rows[0];
      // Step already completed successfully, advance to next step
      const currentStepIndex = steps.findIndex(s => s.id === nextStep.id);
      if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
        // Recursively process the next step
        const remainingSteps = steps.slice(currentStepIndex + 1);
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, tenantId, authToken);
      }
      return;
    }
    // Validate step before execution - check if all required fields are filled by user
    const stepConfig = typeof nextStep.config === 'string' ? JSON.parse(nextStep.config) : nextStep.config;
    const validation = validateStepConfig(nextStepType, stepConfig);
    if (!validation.valid) {
      // Step validation failed - required fields not filled by user
      // Record validation error in activity
      // Per TDD: Use lad_dev schema and include tenant_id and campaign_id
      const leadInfo = await pool.query(
        `SELECT tenant_id, campaign_id FROM ${schema}.campaign_leads WHERE id = $1`,
        [campaignLead.id]
      );
      const { tenant_id, campaign_id } = leadInfo.rows[0] || {};
      if (tenant_id && campaign_id) {
        await pool.query(
          `INSERT INTO ${schema}.campaign_lead_activities 
           (tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status, error_message, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7, CURRENT_TIMESTAMP)`,
          [
            tenant_id,
            campaign_id,
            campaignLead.id,
            nextStep.id,
            nextStepType,
            nextStepType,
            `Validation failed: ${validation.error}. Missing required fields: ${validation.missingFields.join(', ')}. Please configure all required fields in step settings.`
          ]
        );
      }
      // Mark lead as stopped because step configuration is incomplete
      // Per TDD: Use dynamic schema with tenant enforcement
      await pool.query(
        `UPDATE ${schema}.campaign_leads SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
        [campaignLead.id, tenantId]
      );
      return;
    }
    // Check if this is a delay step - if so, check if delay has passed
    // (stepConfig already parsed above during validation)
    if (nextStepType === 'delay') {
      const delayDays = stepConfig.delay_days || stepConfig.delayDays || 0;
      const delayHours = stepConfig.delay_hours || stepConfig.delayHours || 0;
      // Check last activity time
      if (lastSuccessfulActivityResult.rows.length > 0) {
        const lastActivityTime = new Date(lastSuccessfulActivityResult.rows[0].created_at || campaignLead.created_at);
        const now = new Date();
        const delayMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000);
        if (now - lastActivityTime < delayMs) {
          // Delay not yet passed, skip this lead for now
          return;
        }
      }
    }
    // Check if this is a condition step
    // (stepConfig already parsed above during validation)
    if (nextStepType === 'condition') {
      const conditionResult = await executeConditionStep(stepConfig, campaignLead);
      if (!conditionResult.conditionMet) {
        // Condition not met, mark lead as stopped
        // Per TDD: Use dynamic schema with tenant enforcement
        await pool.query(
          `UPDATE ${schema}.campaign_leads SET status = 'stopped' WHERE id = $1 AND tenant_id = $2`,
          [campaignLead.id, tenantId]
        );
        return;
      }
    }
    // Execute the step
    // Lazy load executeStepForLead to avoid circular dependency
    if (!executeStepForLead) {
      const CampaignProcessor = require('./CampaignProcessor');
      executeStepForLead = CampaignProcessor.executeStepForLead;
    }
    const stepResult = await executeStepForLead(campaign.id, nextStep, campaignLead, userId, tenantId, authToken);
    // CRITICAL FIX: After executing a step, continue to the next step if successful
    // This ensures the workflow continues through all steps instead of stopping after the first one
    if (stepResult && stepResult.success) {
      // Find the index of the current step
      const currentStepIndex = steps.findIndex(s => s.id === nextStep.id);
      // If there are more steps, recursively process them
      if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
        const remainingSteps = steps.slice(currentStepIndex + 1);
        // Recursively process remaining steps
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, tenantId, authToken);
      } else {
        // Mark lead as completed if all steps are done
        await pool.query(
          `UPDATE ${schema}.campaign_leads SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
          [campaignLead.id, tenantId]
        );
      }
    } else {
      // Step failed - log error but don't stop workflow (some steps might fail but workflow should continue)
      // Even if step fails, try to continue to next step (user can retry failed steps later)
      const currentStepIndex = steps.findIndex(s => s.id === nextStep.id);
      if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
        const remainingSteps = steps.slice(currentStepIndex + 1);
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, tenantId, authToken);
      }
    }
  } catch (error) {
  }
}
module.exports = {
  processLeadThroughWorkflow
};
