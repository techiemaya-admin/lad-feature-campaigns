/**
 * Workflow Processor
 * Handles processing leads through workflow steps
 */

const { pool } = require('../utils/dbConnection');
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
async function processLeadThroughWorkflow(campaign, steps, campaignLead, userId, orgId, authToken = null) {
  try {
    // Find the last successfully completed step for this lead
    // This ensures we don't re-execute steps that were already completed
    // Per TDD: Use lad_dev schema
    const lastSuccessfulActivityResult = await pool.query(
      const schema = getSchema(req);
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
        console.log(`[Campaign Execution] Last successful step for lead ${campaignLead.id}: step ${lastSuccessfulStepIndex} (${lastSuccessfulActivity.step_id}), advancing to step ${nextStepIndex}`);
      }
    } else {
      // No successful activities yet, start from the beginning
      console.log(`[Campaign Execution] No successful activities found for lead ${campaignLead.id}, starting from step 0`);
    }
    
    if (nextStepIndex >= steps.length) {
      // All steps completed, mark lead as completed
      // Per TDD: Use lad_dev schema
      await pool.query(
        `UPDATE ${schema}.campaign_leads SET status = 'completed' WHERE id = $1`,
        [campaignLead.id]
      );
      return;
    }
    
    const nextStep = steps[nextStepIndex];
    
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
      console.log(`[Campaign Execution] ⏭️  Step ${nextStep.id} (${nextStep.type}) already completed for lead ${campaignLead.id} with status: ${existingActivity.status}. Skipping duplicate execution.`);
      
      // Step already completed successfully, advance to next step
      const currentStepIndex = steps.findIndex(s => s.id === nextStep.id);
      if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
        // Recursively process the next step
        const remainingSteps = steps.slice(currentStepIndex + 1);
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, orgId, authToken);
      }
      return;
    }
    
    // Validate step before execution - check if all required fields are filled by user
    const stepConfig = typeof nextStep.config === 'string' ? JSON.parse(nextStep.config) : nextStep.config;
    const validation = validateStepConfig(nextStep.type, stepConfig);
    
    if (!validation.valid) {
      // Step validation failed - required fields not filled by user
      console.error(`[Campaign Execution] Step ${nextStep.id} (${nextStep.type}) validation failed for lead ${campaignLead.id}`);
      console.error(`[Campaign Execution] Error: ${validation.error}`);
      console.error(`[Campaign Execution] Missing required fields: ${validation.missingFields.join(', ')}`);
      console.error(`[Campaign Execution] User must fill all required fields in step settings before execution`);
      
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
            nextStep.type,
            nextStep.type,
            `Validation failed: ${validation.error}. Missing required fields: ${validation.missingFields.join(', ')}. Please configure all required fields in step settings.`
          ]
        );
      }
      
      // Mark lead as stopped because step configuration is incomplete
      // Per TDD: Use lad_dev schema
      await pool.query(
        `UPDATE ${schema}.campaign_leads SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [campaignLead.id]
      );
      
      console.log(`[Campaign Execution] Lead ${campaignLead.id} stopped due to incomplete step configuration. User must complete step settings.`);
      return;
    }
    
    console.log(`[Campaign Execution] Step ${nextStep.id} (${nextStep.type}) validation passed - all required fields configured`);
    
    // Check if this is a delay step - if so, check if delay has passed
    // (stepConfig already parsed above during validation)
    if (nextStep.type === 'delay') {
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
    if (nextStep.type === 'condition') {
      const conditionResult = await executeConditionStep(stepConfig, campaignLead);
      
      if (!conditionResult.conditionMet) {
        // Condition not met, mark lead as stopped
        // Per TDD: Use lad_dev schema
        await pool.query(
          `UPDATE ${schema}.campaign_leads SET status = 'stopped' WHERE id = $1`,
          [campaignLead.id]
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
    await executeStepForLead(campaign.id, nextStep, campaignLead, userId, orgId, authToken);
    
  } catch (error) {
    console.error(`[Campaign Execution] Error processing lead ${campaignLead.id}:`, error);
  }
}

module.exports = {
  processLeadThroughWorkflow
};

