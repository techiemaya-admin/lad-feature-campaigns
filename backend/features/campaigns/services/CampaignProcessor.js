/**
 * Campaign Processor
 * Handles main campaign processing and step execution
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../../core/utils/schemaHelper');
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
const logger = require('../../../../core/utils/logger');

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
      logger.error('[Campaign Execution] Step validation failed', { stepId: step.id, stepType, error: validation.error, missingFields: validation.missingFields });
      
      return {
        success: false,
        error: validation.error,
        validationError: true,
        missingFields: validation.missingFields
      };
    }
    
    // For lead generation, campaignLead might be a dummy object
    const leadId = campaignLead?.lead_id || campaignLead?.id || 'N/A';
    logger.info('[Campaign Execution] Executing step', { stepId: step.id, stepType, leadId });
    logger.debug('[Campaign Execution] Step config validated - all required fields present');
    
    // Record activity start (skip for lead generation as it's campaign-level and creates leads)
    if (stepType !== 'lead_generation' && campaignLead && campaignLead.id) {
      // Get tenant_id from campaign
      const schema = getSchema(null); // No req available in this context
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
      logger.warn('[Campaign Execution] Unknown step type - marking as success to continue workflow', { stepType });
      result = { success: true, message: `Step type ${stepType} not yet implemented, but workflow continues` };
    }
    
    // Update activity status (only if activity was created)
    if (activityId) {
      const status = result.success ? 'delivered' : 'error';
      await updateActivityStatus(activityId, status, result.error || null);
    }
    
    return result;
  } catch (error) {
    logger.error('[Campaign Execution] Error executing step', { stepId: step.id, error: error.message, stack: error.stack });
    
    // If activity was created, update it to error status
    if (activityId) {
      await updateActivityStatus(activityId, 'error', error.message || 'Unknown error occurred');
    }
    
    return { success: false, error: error.message };
  }
}

async function processCampaign(campaignId, tenantId, authToken = null) {
  try {
    logger.info('[Campaign Execution] Starting processCampaign', { campaignId, tenantId });
    logger.debug('[Campaign Execution] Timestamp', { timestamp: new Date().toISOString() });

    // Test database connection first
    try {
      const testResult = await pool.query('SELECT NOW() as now');
      logger.debug('[Campaign Execution] Database connection test successful', { now: testResult.rows[0]?.now });
    } catch (dbError) {
      logger.error('[Campaign Execution] Database connection test failed', { 
        error: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
        hint: dbError.hint
      });
      throw new Error(`Database connection failed: ${dbError.message}`);
    }

    // Get campaign - don't filter by tenantId here, use the campaign's own tenant_id from DB
    // This allows scheduled service to process all running campaigns regardless of tenantId passed
    // Per TDD: Use dynamic schema resolution based on tenantId
    // Create a mock req object for schema resolution if tenantId is available
    const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(null);
    let query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running' AND tenant_id = $2`;
    let params = [campaignId, tenantId];

    // Try with is_deleted first, fallback without it
    try {
      query += ` AND is_deleted = FALSE`;
    } catch (e) {
      // is_deleted column might not exist, continue without it
    }
    
    logger.debug('[Campaign Execution] Querying campaign', { query, params });

    let campaignResult;
    try {
      campaignResult = await pool.query(query, params);
    } catch (error) {
      // If is_deleted column doesn't exist, try without it
      if (error.message && error.message.includes('is_deleted')) {
        logger.warn('[Campaign Execution] is_deleted column not found, trying without it');
        query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running' AND tenant_id = $2`;
        campaignResult = await pool.query(query, params);
      } else {
        throw error;
      }
    }

    if (campaignResult.rows.length === 0) {
      logger.warn('[Campaign Execution] Campaign not found or not running', { campaignId, rowsReturned: campaignResult.rows.length });
      return;
    }

    const campaign = campaignResult.rows[0];
    const userIdFromCampaign = campaign.created_by_user_id;
    const tenantIdFromCampaign = campaign.tenant_id;
    const executionState = campaign.execution_state || 'active';
    const nextRunAt = campaign.next_run_at;
    const lastLeadCheckAt = campaign.last_lead_check_at;

    logger.info('[Campaign Execution] Found campaign', { campaignId: campaign.id, campaignName: campaign.name || 'unnamed', status: campaign.status, executionState, userId: userIdFromCampaign, tenantId: tenantIdFromCampaign });

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
          logger.info('[Campaign Execution] Skipping campaign', { reason });
          
          // Update last_execution_reason for visibility
          await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
            lastExecutionReason: reason
          });
          
          return; // Skip execution
        }
      }
      
      // Also check if next_run_at is set and hasn't been reached
      if (nextRunAt) {
        const nextRunTime = new Date(nextRunAt);
        if (now < nextRunTime) {
          const minutesUntilNextRun = Math.ceil((nextRunTime.getTime() - now.getTime()) / (60 * 1000));
          const reason = `Campaign skipped: waiting for leads (scheduled retry in ${minutesUntilNextRun} minutes)`;
          logger.info('[Campaign Execution] Skipping campaign', { reason });
          
          await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
            lastExecutionReason: reason
          });
          
          return; // Skip execution
        }
      }
      
      // Retry time reached - reset to active and continue
      logger.info('[Campaign Execution] Retry time reached, resuming campaign execution', { campaignId });
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
          logger.info('[Campaign Execution] Skipping campaign', { reason });
          
          await CampaignModel.updateExecutionState(campaignId, 'sleeping_until_next_day', {
            lastExecutionReason: reason
          });
          
          return; // Skip execution
        }
      }
      
      // Next day reached - reset to active and continue
      logger.info('[Campaign Execution] Next day reached, resuming campaign execution', { campaignId });
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        nextRunAt: null,
        lastExecutionReason: 'Next day reached, resuming execution'
      });
    }
    
    if (executionState === 'error') {
      // Error state - log but don't process (user should investigate)
      logger.warn('[Campaign Execution] Campaign in error state', { campaignId, reason: campaign.last_execution_reason || 'Unknown error' });
      return; // Skip execution
    }

    // Get campaign steps in order
    // Per TDD: Use lad_dev schema and step_order column (fallback to order if step_order doesn't exist)
    let stepsResult;
    try {
      // First try with step_order
      stepsResult = await pool.query(
        `SELECT * FROM ${schema}.campaign_steps 
         WHERE campaign_id = $1 
         ORDER BY step_order ASC`,
        [campaignId]
      );
    } catch (error) {
      // If step_order column doesn't exist, try with order
      if (error.message && error.message.includes('step_order')) {
        logger.warn('[Campaign Execution] step_order column not found, trying order', { error: error.message });
        try {
          stepsResult = await pool.query(
            `SELECT * FROM ${schema}.campaign_steps 
             WHERE campaign_id = $1 
             ORDER BY "order" ASC`,
            [campaignId]
          );
        } catch (orderError) {
          // If order also fails, try without ordering
          if (orderError.message && orderError.message.includes('order')) {
            logger.warn('[Campaign Execution] order column also not found, trying without ORDER BY', { error: orderError.message });
            stepsResult = await pool.query(
              `SELECT * FROM ${schema}.campaign_steps 
               WHERE campaign_id = $1`,
              [campaignId]
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
      logger.warn('[Campaign Execution] Campaign has no steps, skipping execution', { campaignId });
      logger.info('[Campaign Execution] TIP: Steps must be created for the campaign before it can run. Check if steps were created when the campaign was created, or add steps via POST /api/campaigns/:id/steps');
      
      // Debug: Check if steps exist with different tenant_id
      try {
        const debugResult = await pool.query(
          `SELECT COUNT(*) as count, tenant_id FROM ${schema}.campaign_steps WHERE campaign_id = $1 GROUP BY tenant_id`,
          [campaignId]
        );
        if (debugResult.rows.length > 0) {
          logger.debug('[Campaign Execution] Found steps with different tenant_ids', { steps: debugResult.rows });
        }
      } catch (debugError) {
        // Ignore debug errors
      }
      
      return;
    }

    logger.info('[Campaign Execution] Found steps for campaign', { campaignId, stepCount: steps.length, stepTypes: steps.map(s => ({ id: s.id, type: s.step_type || s.type, order: s.step_order || s.order })) });
    
    const leadGenerationStep = steps.find(s => (s.step_type || s.type) === 'lead_generation');
    
    // Declare leadGenResult outside the if block so it's accessible later
    let leadGenResult = null;

    if (leadGenerationStep) {
      logger.info('[Campaign Execution] Found lead generation step', { stepId: leadGenerationStep.id, order: leadGenerationStep.step_order || leadGenerationStep.order, configType: typeof leadGenerationStep.config });
      
      // Parse step config
      let stepWithParsedConfig = { ...leadGenerationStep };
      if (typeof leadGenerationStep.config === 'string') {
        try {
          stepWithParsedConfig.config = JSON.parse(leadGenerationStep.config);
          logger.debug('[Campaign Execution] Successfully parsed step config');
        } catch (parseErr) {
          logger.error('[Campaign Execution] Failed to parse lead generation step config', { error: parseErr.message });
          stepWithParsedConfig.config = {};
        }
      } else if (leadGenerationStep.config) {
        stepWithParsedConfig.config = leadGenerationStep.config;
        logger.debug('[Campaign Execution] Step config is already an object');
      } else {
        logger.warn('[Campaign Execution] Step config is empty or null');
        stepWithParsedConfig.config = {};
      }

      // Create a dummy lead object for the initial call to executeStepForLead
      // The actual leads will be generated and saved by executeLeadGeneration
      const dummyLead = { id: null, campaign_id: campaignId }; 

      logger.info('[Campaign Execution] Executing lead generation', { campaignId, hasAuthToken: !!authToken, userId: userIdFromCampaign, tenantId: tenantIdFromCampaign });
      
      leadGenResult = await executeStepForLead(campaignId, stepWithParsedConfig, dummyLead, userIdFromCampaign, tenantIdFromCampaign, authToken);
      
      logger.debug('[Campaign Execution] Lead generation result', { result: leadGenResult });

      if (!leadGenResult.success) {
        logger.error('[Campaign Execution] Lead generation failed', { campaignId, error: leadGenResult.error, fullResult: leadGenResult });
        // Don't return here - continue processing existing leads even if generation failed
      } else {
        logger.info('[Campaign Execution] Lead generation completed successfully', { campaignId, leadsFound: leadGenResult.leadsFound || 0, leadsSaved: leadGenResult.leadsSaved || 0 });
      }
    } else {
      logger.warn('[Campaign Execution] No lead generation step found, skipping lead generation', { campaignId, availableSteps: steps.map(s => ({ type: s.step_type || s.type, title: s.title || 'no title' })) });
    }

    // Fetch leads for the campaign (after potential lead generation)
    // Per TDD: Use lad_dev schema
    let leadsResult;
    try {
      // Try with all columns first
      leadsResult = await pool.query(
        `SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
         FROM ${schema}.campaign_leads 
         WHERE campaign_id = $1 
         AND status = 'active' 
         AND is_deleted = FALSE`,
        [campaignId]
      );
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      // If snapshot column doesn't exist, try without it
      if (errorMsg.includes('snapshot') || errorMsg.includes('column') && errorMsg.includes('does not exist')) {
        logger.warn('[Campaign Execution] snapshot column not found, trying without it', { error: error.message });
        try {
          leadsResult = await pool.query(
            `SELECT id, campaign_id, lead_id, status, lead_data 
             FROM ${schema}.campaign_leads 
             WHERE campaign_id = $1 
             AND status = 'active' 
             AND is_deleted = FALSE`,
            [campaignId]
          );
        } catch (error2) {
          // If is_deleted column also doesn't exist, try without both
          if (error2.message && error2.message.includes('is_deleted')) {
            logger.warn('[Campaign Execution] is_deleted column also not found, trying without both', { error: error2.message });
            leadsResult = await pool.query(
              `SELECT id, campaign_id, lead_id, status, lead_data 
               FROM ${schema}.campaign_leads 
               WHERE campaign_id = $1 
               AND status = 'active'`,
              [campaignId]
            );
          } else {
            throw error2;
          }
        }
      } else if (errorMsg.includes('is_deleted')) {
        // If only is_deleted is missing, try without it but keep snapshot
        logger.warn('[Campaign Execution] is_deleted column not found, trying without it', { error: error.message });
        try {
          leadsResult = await pool.query(
            `SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
             FROM ${schema}.campaign_leads 
             WHERE campaign_id = $1 
             AND status = 'active'`,
            [campaignId]
          );
        } catch (error2) {
          // If snapshot also doesn't exist, try without both
          if (error2.message && error2.message.includes('snapshot')) {
            logger.warn('[Campaign Execution] snapshot column also not found, trying without both', { error: error2.message });
            leadsResult = await pool.query(
              `SELECT id, campaign_id, lead_id, status, lead_data 
               FROM ${schema}.campaign_leads 
               WHERE campaign_id = $1 
               AND status = 'active'`,
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
    
    logger.info('[Campaign Execution] Processed leads for campaign', { campaignId, leadCount: leads.length });
    
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
      
      logger.info('[Campaign Execution] Campaign set to sleeping_until_next_day after processing all leads', { campaignId, resumesAt: tomorrow.toISOString() });
    } else if (!leadGenResult || !leadGenResult.success) {
      // If lead generation didn't run or failed, but we have existing leads, keep active
      // This handles the case where campaigns have leads but no lead generation step
      if (leads.length > 0) {
        logger.info('[Campaign Execution] Campaign has leads to process, keeping active', { campaignId, leadCount: leads.length });
        await CampaignModel.updateExecutionState(campaignId, 'active', {
          lastExecutionReason: `Processing ${leads.length} existing leads through workflow.`
        });
      }
    }
  } catch (error) {
    logger.error('[Campaign Execution] Error processing campaign', { campaignId, error: error.message, stack: error.stack });
  }
}

module.exports = {
  executeStepForLead,
  processCampaign
};

