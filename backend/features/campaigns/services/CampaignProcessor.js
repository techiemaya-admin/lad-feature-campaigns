/**
 * Campaign Processor
 * Handles main campaign processing and step execution
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
 */
const { pool } = require('../../../shared/database/connection');
const { validateStepConfig } = require('./StepValidators');
const { createActivity, updateActivityStatus } = require('./CampaignActivityService');
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
const { processLeadThroughWorkflow } = require('./WorkflowProcessor');
const CampaignModel = require('../models/CampaignModel');
/**
 * Execute a campaign step for a specific lead
 */
async function executeStepForLead(campaignId, step, campaignLead, userId, tenantId, authToken = null) {
  // Declare activityId outside try block so it's accessible in catch
  let activityId = null;
  try {
    const stepType = step.step_type || step.type;
    const stepConfig = typeof step.config === 'string' ? JSON.parse(step.config) : step.config;
    // VALIDATE: Check if all required fields are filled before executing
    const validation = validateStepConfig(stepType, stepConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        validationError: true,
        missingFields: validation.missingFields
      };
    }
    // For lead generation, campaignLead might be a dummy object
    const leadId = campaignLead?.lead_id || campaignLead?.id || 'N/A';
    // Record activity start (skip for lead generation as it's campaign-level and creates leads)
    if (stepType !== 'lead_generation' && campaignLead && campaignLead.id) {
      // Get tenant_id from campaign
      const schema = process.env.DB_SCHEMA || 'lad_dev'; // No req available in this context
      const campaignQuery = await pool.query(
        `SELECT tenant_id FROM ${schema}.campaigns WHERE id = $1 AND is_deleted = FALSE`,
        [campaignId]
      );
      if (campaignQuery.rows.length > 0) {
        const tenantId = campaignQuery.rows[0].tenant_id;
        activityId = await createActivity(campaignId, tenantId, campaignLead.id, step.id, stepType);
      }
    }
    let result = { success: false, error: 'Unknown step type' };
    // Handle all step types dynamically based on step type
    if (stepType === 'lead_generation') {
      result = await executeLeadGeneration(campaignId, step, stepConfig, userId, tenantId, authToken);
    } else if (stepType && stepType.startsWith('linkedin_')) {
      // All LinkedIn steps: connect, message, follow, visit, scrape_profile, company_search, employee_list, autopost, comment_reply
      result = await executeLinkedInStep(stepType, stepConfig, campaignLead, userId, tenantId);
    } else if (stepType && stepType.startsWith('email_')) {
      // All email steps: send, followup
      result = await executeEmailStep(stepType, stepConfig, campaignLead, userId, tenantId);
    } else if (stepType && stepType.startsWith('whatsapp_')) {
      // WhatsApp steps: send
      result = await executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, tenantId);
    } else if (stepType && stepType.startsWith('instagram_')) {
      // Instagram steps: follow, like, dm, autopost, comment_reply, story_view
      result = await executeInstagramStep(stepType, stepConfig, campaignLead, userId, tenantId);
    } else if (stepType === 'voice_agent_call') {
      result = await executeVoiceAgentStep(stepConfig, campaignLead, userId, tenantId);
    } else if (stepType === 'delay') {
      result = await executeDelayStep(stepConfig);
    } else if (stepType === 'condition') {
      result = await executeConditionStep(stepConfig, campaignLead);
    } else if (stepType === 'start' || stepType === 'end') {
      // Start and end nodes are just markers, skip execution
      result = { success: true, message: 'Start/End node - no action needed' };
    } else {
      result = { success: true, message: `Step type ${stepType} not yet implemented, but workflow continues` };
    }
    // Update activity status (only if activity was created)
    if (activityId) {
      const status = result.success ? 'delivered' : 'error';
      await updateActivityStatus(activityId, status, result.error || null);
    }
    return result;
  } catch (error) {
    // If activity was created, update it to error status
    if (activityId) {
      await updateActivityStatus(activityId, 'error', error.message || 'Unknown error occurred');
    }
    return { success: false, error: error.message };
  }
}
async function processCampaign(campaignId, tenantId, authToken = null) {
  try {
    // Test database connection first
    try {
      const testResult = await pool.query('SELECT NOW() as now');
    } catch (dbError) {
      throw new Error(`Database connection failed: ${dbError.message}`);
    }
    // Get campaign - don't filter by tenantId here, use the campaign's own tenant_id from DB
    // This allows scheduled service to process all running campaigns regardless of tenantId passed
    // Per TDD: Use dynamic schema resolution based on tenantId
    // Create a mock req object for schema resolution if tenantId is available
    const schema = process.env.DB_SCHEMA || 'lad_dev';
    let query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running' AND tenant_id = $2`;
    let params = [campaignId, tenantId];
    // Try with is_deleted first, fallback without it
    try {
      query += ` AND is_deleted = FALSE`;
    } catch (e) {
      // is_deleted column might not exist, continue without it
    }
    let campaignResult;
    try {
      campaignResult = await pool.query(query, params);
    } catch (error) {
      // If is_deleted column doesn't exist, try without it
      if (error.message && error.message.includes('is_deleted')) {
        query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running' AND tenant_id = $2`;
        campaignResult = await pool.query(query, params);
      } else {
        throw error;
      }
    }
    if (campaignResult.rows.length === 0) {
      return { success: false, skipped: true, reason: 'Campaign not found or not running', campaignId, leadCount: 0 };
    }
    const campaign = campaignResult.rows[0];
    const userIdFromCampaign = campaign.created_by_user_id;
    const tenantIdFromCampaign = campaign.tenant_id;
    const executionState = campaign.execution_state || 'active';
    const nextRunAt = campaign.next_run_at;
    const lastLeadCheckAt = campaign.last_lead_check_at;
    // PRODUCTION-GRADE: Check execution state before processing
    // This prevents unnecessary retries and wasted compute
    const now = new Date();
    if (executionState === 'waiting_for_leads') {
      // Check if retry time has been reached
      const retryIntervalHours = process.env.LEAD_RETRY_INTERVAL_HOURS || 6; // Default 6 hours
      const retryIntervalMs = retryIntervalHours * 60 * 60 * 1000;
      if (lastLeadCheckAt) {
        const lastCheckTime = new Date(lastLeadCheckAt);
        const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
        if (timeSinceLastCheck < retryIntervalMs) {
          const hoursUntilRetry = Math.ceil((retryIntervalMs - timeSinceLastCheck) / (60 * 60 * 1000));
          const reason = `Campaign skipped: waiting for leads (retry in ${hoursUntilRetry}h)`;
          // Update last_execution_reason for visibility
          await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
            lastExecutionReason: reason
          });
          return { success: false, skipped: true, reason, campaignId, leadCount: 0 }; // Skip execution
        }
      }
      // Also check if next_run_at is set and hasn't been reached
      if (nextRunAt) {
        const nextRunTime = new Date(nextRunAt);
        if (now < nextRunTime) {
          const minutesUntilNextRun = Math.ceil((nextRunTime.getTime() - now.getTime()) / (60 * 1000));
          const reason = `Campaign skipped: waiting for leads (scheduled retry in ${minutesUntilNextRun} minutes)`;
          await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
            lastExecutionReason: reason
          });
          return { success: false, skipped: true, reason, campaignId, leadCount: 0 }; // Skip execution
        }
      }
      // Retry time reached - reset to active and continue
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        lastExecutionReason: 'Retry time reached, checking for leads again'
      });
    }
    if (executionState === 'sleeping_until_next_day') {
      if (nextRunAt) {
        const nextRunTime = new Date(nextRunAt);
        if (now < nextRunTime) {
          const hoursUntilNextDay = Math.ceil((nextRunTime.getTime() - now.getTime()) / (60 * 60 * 1000));
          const reason = `Campaign sleeping until next day (resumes in ${hoursUntilNextDay}h)`;
          await CampaignModel.updateExecutionState(campaignId, 'sleeping_until_next_day', {
            lastExecutionReason: reason
          });
          return { success: false, skipped: true, reason, campaignId, leadCount: 0 }; // Skip execution
        }
      }
      // Next day reached - reset to active and continue
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        nextRunAt: null,
        lastExecutionReason: 'Next day reached, resuming execution'
      });
    }
    if (executionState === 'error') {
      // Error state - log but don't process (user should investigate)
      return { success: false, skipped: true, reason: 'Campaign in error state', campaignId, leadCount: 0 }; // Skip execution
    }
    // Get campaign steps in order
    // Per TDD: Use lad_dev schema and step_order column (fallback to order if step_order doesn't exist)
    let stepsResult;
    try {
      // First try with step_order and step_type, aliasing for compatibility
      stepsResult = await pool.query(
        `SELECT *, step_type as type FROM ${schema}.campaign_steps 
         WHERE campaign_id = $1 AND tenant_id = $2
         ORDER BY step_order ASC`,
        [campaignId, tenantId]
      );
    } catch (error) {
      // If step_order or step_type columns don't exist, try with order and type
      if (error.message && (error.message.includes('step_order') || error.message.includes('step_type'))) {
        try {
          stepsResult = await pool.query(
            `SELECT * FROM ${schema}.campaign_steps 
             WHERE campaign_id = $1 AND tenant_id = $2
             ORDER BY "order" ASC`,
            [campaignId, tenantId]
          );
        } catch (orderError) {
          // If order also fails, try without ordering
          if (orderError.message && orderError.message.includes('order')) {
            stepsResult = await pool.query(
              `SELECT * FROM ${schema}.campaign_steps 
               WHERE campaign_id = $1 AND tenant_id = $2`,
              [campaignId, tenantId]
            );
          } else {
            throw orderError;
          }
        }
      } else {
        throw error;
      }
    }
    const steps = stepsResult.rows;
    if (steps.length === 0) {
      // Debug: Check if steps exist with different tenant_id
      try {
        const debugResult = await pool.query(
          `SELECT COUNT(*) as count, tenant_id FROM ${schema}.campaign_steps WHERE campaign_id = $1 GROUP BY tenant_id`,
          [campaignId]
        );
        if (debugResult.rows.length > 0) {
        }
      } catch (debugError) {
        // Ignore debug errors
      }
      return { success: false, skipped: true, reason: 'Campaign has no steps', campaignId, leadCount: 0 };
    }
    // Parse campaign config to check if it's an inbound campaign
    let campaignConfig = {};
    if (campaign.config) {
      campaignConfig = typeof campaign.config === 'string' ? JSON.parse(campaign.config) : campaign.config;
    }
    const isInboundCampaign = campaignConfig.campaign_type === 'inbound';

    const leadGenerationStep = steps.find(s => (s.step_type || s.type) === 'lead_generation');
    // Declare leadGenResult outside the if block so it's accessible later
    let leadGenResult = null;
    // Skip lead generation for inbound campaigns - leads are already uploaded
    if (leadGenerationStep && !isInboundCampaign) {
      // Parse step config
      let stepWithParsedConfig = { ...leadGenerationStep };
      if (typeof leadGenerationStep.config === 'string') {
        try {
          stepWithParsedConfig.config = JSON.parse(leadGenerationStep.config);
        } catch (parseErr) {
          stepWithParsedConfig.config = {};
        }
      } else if (leadGenerationStep.config) {
        stepWithParsedConfig.config = leadGenerationStep.config;
      } else {
        stepWithParsedConfig.config = {};
      }
      // Create a dummy lead object for the initial call to executeStepForLead
      // The actual leads will be generated and saved by executeLeadGeneration
      const dummyLead = { id: null, campaign_id: campaignId }; 
      leadGenResult = await executeStepForLead(campaignId, stepWithParsedConfig, dummyLead, userIdFromCampaign, tenantIdFromCampaign, authToken);
      if (!leadGenResult.success) {
        // Don't return here - continue processing existing leads even if generation failed
      }
    } else if (isInboundCampaign) {

    }
    // Fetch leads for the campaign (after potential lead generation)
    // Per TDD: Use lad_dev schema

    let leadsResult;
    try {
      // Try with all columns first
      // Include both 'pending' and 'active' status for inbound campaigns
      leadsResult = await pool.query(
        `SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
         FROM ${schema}.campaign_leads 
         WHERE campaign_id = $1 
         AND status IN ('pending', 'active') 
         AND is_deleted = FALSE`,
        [campaignId]
      );
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      // If snapshot column doesn't exist, try without it
      if (errorMsg.includes('snapshot') || errorMsg.includes('column') && errorMsg.includes('does not exist')) {
        try {
          leadsResult = await pool.query(
            `SELECT id, campaign_id, lead_id, status, lead_data 
             FROM ${schema}.campaign_leads 
             WHERE campaign_id = $1 
             AND status IN ('pending', 'active') 
             AND is_deleted = FALSE`,
            [campaignId]
          );
        } catch (error2) {
          // If is_deleted column also doesn't exist, try without both
          if (error2.message && error2.message.includes('is_deleted')) {
            leadsResult = await pool.query(
              `SELECT id, campaign_id, lead_id, status, lead_data 
               FROM ${schema}.campaign_leads 
               WHERE campaign_id = $1 
               AND status IN ('pending', 'active')`,
              [campaignId]
            );
          } else {
            throw error2;
          }
        }
      } else if (errorMsg.includes('is_deleted')) {
        // If only is_deleted is missing, try without it but keep snapshot
        try {
          leadsResult = await pool.query(
            `SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
             FROM ${schema}.campaign_leads 
             WHERE campaign_id = $1 
             AND status IN ('pending', 'active')`,
            [campaignId]
          );
        } catch (error2) {
          // If snapshot also doesn't exist, try without both
          if (error2.message && error2.message.includes('snapshot')) {
            leadsResult = await pool.query(
              `SELECT id, campaign_id, lead_id, status, lead_data 
               FROM ${schema}.campaign_leads 
               WHERE campaign_id = $1 
               AND status IN ('pending', 'active')`,
              [campaignId]
            );
          } else {
            throw error2;
          }
        }
      } else {
        throw error;
      }
    }
    const leads = leadsResult.rows;

    if (leads.length === 0) {

      if (isInboundCampaign) {
      }
    }
    // Process each lead through the workflow (skip lead generation, start, and end steps)
    const workflowSteps = steps.filter(s => {
      const stepType = s.step_type || s.type;
      return stepType !== 'lead_generation' && 
             stepType !== 'start' && 
             stepType !== 'end';
    });

    // Per TDD: Use tenant_id and created_by_user_id
    for (const lead of leads) {
      await processLeadThroughWorkflow(campaign, workflowSteps, lead, userIdFromCampaign, tenantIdFromCampaign, authToken);
    }

    // PRODUCTION-GRADE: After processing all leads, check if we should sleep
    // Only set to sleep if daily limit was reached AND all leads have been processed
    if (leadGenResult && leadGenResult.success && leadGenResult.dailyLimitReached) {
      // Daily limit was reached during lead generation
      // Now that all leads are processed, set to sleep
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0); // Start of next day
      await CampaignModel.updateExecutionState(campaignId, 'sleeping_until_next_day', {
        nextRunAt: tomorrow.toISOString(),
        lastExecutionReason: `Daily limit reached. All leads processed. Resuming tomorrow.`
      });
    } else if (!leadGenResult || !leadGenResult.success) {
      // If lead generation didn't run or failed, but we have existing leads, keep active
      // This handles the case where campaigns have leads but no lead generation step
      if (leads.length > 0) {
        await CampaignModel.updateExecutionState(campaignId, 'active', {
          lastExecutionReason: `Processing ${leads.length} existing leads through workflow.`
        });
      }
    }
    // Return success to signal completion to caller
    return { success: true, campaignId, leadCount: leads.length };
  } catch (error) {
    throw error; // Re-throw to properly reject the promise
  }
}
module.exports = {
  executeStepForLead,
  processCampaign
};
