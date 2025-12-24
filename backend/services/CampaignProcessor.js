/**
 * Campaign Processor
 * Handles main campaign processing and workflow orchestration
 */

const { pool } = require('../../../shared/database/connection');
const { validateStepConfig, getChannelForStepType } = require('./StepValidators');
const { executeLeadGeneration } = require('./LeadGenerationService');
const { executeLinkedInStep } = require('./LinkedInStepExecutor');
const { 
  executeEmailStep, 
  executeWhatsAppStep, 
  executeInstagramStep, 
  executeVoiceAgentStep, 
  executeDelayStep, 
  executeConditionStep 
} = require('./StepExecutors');

/**
 * Execute a campaign step for a specific lead
 */
async function executeStepForLead(campaignId, step, campaignLead, userId, orgId) {
  // Declare activityId outside try block so it's accessible in catch
  let activityId = null;
  
  try {
    const stepType = step.type;
    const stepConfig = typeof step.config === 'string' ? JSON.parse(step.config) : step.config;
    
    // VALIDATE: Check if all required fields are filled before executing
    const validation = validateStepConfig(stepType, stepConfig);
    if (!validation.valid) {
      console.error(`[Campaign Execution] Step ${step.id} (${stepType}) validation failed:`, validation.error);
      console.error(`[Campaign Execution] Missing fields:`, validation.missingFields);
      
      return {
        success: false,
        error: validation.error,
        validationError: true,
        missingFields: validation.missingFields
      };
    }
    
    // For lead generation, campaignLead might be a dummy object
    const leadId = campaignLead?.lead_id || campaignLead?.id || 'N/A';
    console.log(`[Campaign Execution] Executing step ${step.id} (${stepType}) for lead ${leadId}`);
    console.log(`[Campaign Execution] Step config validated - all required fields present`);
    
    // Record activity start (skip for lead generation as it's campaign-level and creates leads)
    if (stepType !== 'lead_generation' && campaignLead && campaignLead.id) {
      const activityResult = await pool.query(
        `INSERT INTO campaign_lead_activities 
         (campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
         VALUES ($1, $2, $3, $4, 'sent', $5, CURRENT_TIMESTAMP)
         RETURNING id`,
        [campaignLead.id, step.id, stepType, stepType, getChannelForStepType(stepType)]
      );
      
      activityId = activityResult.rows[0].id;
    }
    
    let result = { success: false, error: 'Unknown step type' };
    
    // Handle all step types dynamically based on step type
    if (stepType === 'lead_generation') {
      result = await executeLeadGeneration(campaignId, step, stepConfig, userId, orgId);
    } else if (stepType.startsWith('linkedin_')) {
      // All LinkedIn steps: connect, message, follow, visit, scrape_profile, company_search, employee_list, autopost, comment_reply
      result = await executeLinkedInStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('email_')) {
      // All email steps: send, followup
      result = await executeEmailStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('whatsapp_')) {
      // WhatsApp steps: send
      result = await executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('instagram_')) {
      // Instagram steps: follow, like, dm, autopost, comment_reply, story_view
      result = await executeInstagramStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType === 'voice_agent_call') {
      result = await executeVoiceAgentStep(stepConfig, campaignLead, userId, orgId);
    } else if (stepType === 'delay') {
      result = await executeDelayStep(stepConfig);
    } else if (stepType === 'condition') {
      result = await executeConditionStep(stepConfig, campaignLead);
    } else if (stepType === 'start' || stepType === 'end') {
      // Start and end nodes are just markers, skip execution
      result = { success: true, message: 'Start/End node - no action needed' };
    } else {
      console.warn(`[Campaign Execution] Unknown step type: ${stepType} - marking as success to continue workflow`);
      result = { success: true, message: `Step type ${stepType} not yet implemented, but workflow continues` };
    }
    
    // Update activity status (only if activity was created)
    if (activityId) {
      const status = result.success ? 'delivered' : 'error';
      await pool.query(
        `UPDATE campaign_lead_activities 
         SET status = $1, 
             error_message = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [status, result.error || null, activityId]
      );
      
      // If step was successful, handle status updates based on step type
      if (result.success) {
        // For LinkedIn messages, mark as 'replied' if there's a reply, otherwise keep as 'delivered'
        if (stepType === 'linkedin_message') {
          // Messages are marked as 'delivered' when sent successfully
          // They will be updated to 'replied' when a reply is received (via webhook or polling)
          // Keep as 'delivered' for now
        }
        // For connection requests, keep as 'delivered' when sent
        // They will be updated to 'connected' when accepted (via webhook)
        // DO NOT mark as 'connected' immediately - wait for webhook confirmation
      }
    }
    
    return result;
  } catch (error) {
    console.error(`[Campaign Execution] Error executing step ${step.id}:`, error);
    
    // If activity was created, update it to error status
    if (activityId) {
      try {
        await pool.query(
          `UPDATE campaign_lead_activities 
           SET status = 'error', 
               error_message = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [error.message || 'Unknown error occurred', activityId]
        );
      } catch (updateErr) {
        console.error(`[Campaign Execution] Error updating activity status:`, updateErr);
      }
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Process a running campaign
 */
async function processCampaign(campaignId) {
  try {
    console.log(`[Campaign Execution] Processing campaign ${campaignId}`);
    
    // Get campaign
    const campaignResult = await pool.query(
      `SELECT * FROM campaigns WHERE id = $1 AND status = 'running' AND is_deleted = FALSE`,
      [campaignId]
    );
    
    if (campaignResult.rows.length === 0) {
      console.log(`[Campaign Execution] Campaign ${campaignId} not found or not running`);
      return;
    }
    
    const campaign = campaignResult.rows[0];
    
    // Get campaign steps in order
    const stepsResult = await pool.query(
      `SELECT * FROM campaign_steps 
       WHERE campaign_id = $1 
       ORDER BY "order" ASC`,
      [campaignId]
    );
    
    const steps = stepsResult.rows;
    if (steps.length === 0) {
      console.log(`[Campaign Execution] No steps found for campaign ${campaignId}`);
      return;
    }
    
    // Check if lead generation step exists - run daily lead generation
    console.log(`[Campaign Execution] Campaign ${campaignId} has ${steps.length} steps. Step types:`, steps.map(s => s.type));
    const leadGenStep = steps.find(s => s.type === 'lead_generation');
    if (leadGenStep) {
      // Always run lead generation daily (respects daily limit and offset)
      console.log(`[Campaign Execution] Executing daily lead generation step for campaign ${campaignId}`);
        const dummyLead = { id: null, lead_id: 'lead_gen', campaign_id: campaignId };
      const leadGenResult = await executeStepForLead(campaignId, leadGenStep, dummyLead, campaign.created_by, campaign.organization_id);
      console.log(`[Campaign Execution] Lead generation result:`, leadGenResult);
      } else {
      console.warn(`[Campaign Execution] No lead_generation step found for campaign ${campaignId}. Steps:`, steps.map(s => ({ id: s.id, type: s.type, title: s.title })));
      console.warn(`[Campaign Execution] Campaign will not generate leads automatically. Make sure the campaign was created with target criteria (industries, location, or roles).`);
    }
    
    // Get active leads for this campaign
    const leadsResult = await pool.query(
      `SELECT * FROM campaign_leads 
       WHERE campaign_id = $1 AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 10`,
      [campaignId]
    );
    
    const leads = leadsResult.rows;
    
    // Process each lead through the workflow (skip lead generation, start, and end steps)
    const workflowSteps = steps.filter(s => 
      s.type !== 'lead_generation' && 
      s.type !== 'start' && 
      s.type !== 'end'
    );
    
    for (const lead of leads) {
      await processLeadThroughWorkflow(campaign, workflowSteps, lead, campaign.created_by, campaign.organization_id);
    }
    
    console.log(`[Campaign Execution] Processed ${leads.length} leads for campaign ${campaignId}`);
  } catch (error) {
    console.error(`[Campaign Execution] Error processing campaign ${campaignId}:`, error);
  }
}

/**
 * Process a lead through the workflow steps
 */
async function processLeadThroughWorkflow(campaign, steps, campaignLead, userId, orgId) {
  try {
    // Find the last successfully completed step for this lead
    // This ensures we don't re-execute steps that were already completed
    const lastSuccessfulActivityResult = await pool.query(
      `SELECT step_id, status, created_at FROM campaign_lead_activities 
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
      await pool.query(
        `UPDATE campaign_leads SET status = 'completed' WHERE id = $1`,
        [campaignLead.id]
      );
      return;
    }
    
    const nextStep = steps[nextStepIndex];
    
    // CRITICAL: Check if this step has already been successfully executed for this lead
    // This prevents duplicate execution of steps like "Visit LinkedIn Profile" or "Send Connection Request"
    const existingActivityResult = await pool.query(
      `SELECT id, status FROM campaign_lead_activities 
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
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, orgId);
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
      await pool.query(
        `INSERT INTO campaign_lead_activities 
         (campaign_lead_id, step_id, step_type, action_type, status, error_message, created_at)
         VALUES ($1, $2, $3, $4, 'error', $5, CURRENT_TIMESTAMP)`,
        [
          campaignLead.id,
          nextStep.id,
          nextStep.type,
          nextStep.type,
          `Validation failed: ${validation.error}. Missing required fields: ${validation.missingFields.join(', ')}. Please configure all required fields in step settings.`
        ]
      );
      
      // Mark lead as stopped because step configuration is incomplete
      await pool.query(
        `UPDATE campaign_leads SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
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
        await pool.query(
          `UPDATE campaign_leads SET status = 'stopped' WHERE id = $1`,
          [campaignLead.id]
        );
        return;
      }
    }
    
    // Execute the step
    await executeStepForLead(campaign.id, nextStep, campaignLead, userId, orgId);
    
  } catch (error) {
    console.error(`[Campaign Execution] Error processing lead ${campaignLead.id}:`, error);
  }
}

module.exports = {
  executeStepForLead,
  processCampaign,
  processLeadThroughWorkflow
};

