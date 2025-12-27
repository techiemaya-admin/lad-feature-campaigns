/**
 * Campaign Processor
 * Handles main campaign processing and step execution
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../../../core/utils/schemaHelper');
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
async function executeStepForLead(campaignId, step, campaignLead, userId, orgId, authToken = null) {
  // Declare activityId outside try block so it's accessible in catch
  let activityId = null;
  
  try {
    const stepType = step.step_type || step.type;
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
      // Get tenant_id from campaign
      const campaignQuery = await pool.query(
        const schema = getSchema(req);
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
      result = await executeLeadGeneration(campaignId, step, stepConfig, userId, orgId, authToken);
    } else if (stepType && stepType.startsWith('linkedin_')) {
      // All LinkedIn steps: connect, message, follow, visit, scrape_profile, company_search, employee_list, autopost, comment_reply
      result = await executeLinkedInStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType && stepType.startsWith('email_')) {
      // All email steps: send, followup
      result = await executeEmailStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType && stepType.startsWith('whatsapp_')) {
      // WhatsApp steps: send
      result = await executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType && stepType.startsWith('instagram_')) {
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
      await updateActivityStatus(activityId, status, result.error || null);
    }
    
    return result;
  } catch (error) {
    console.error(`[Campaign Execution] Error executing step ${step.id}:`, error);
    
    // If activity was created, update it to error status
    if (activityId) {
      await updateActivityStatus(activityId, 'error', error.message || 'Unknown error occurred');
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Process a running campaign
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
 */
async function processCampaign(campaignId, tenantId, authToken = null) {
  try {
    console.log(`[Campaign Execution] 🚀 Starting processCampaign for ${campaignId}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
    console.log(`[Campaign Execution] ⏰ Timestamp: ${new Date().toISOString()}`);

    // Test database connection first
    try {
      const testResult = await pool.query('SELECT NOW() as now');
      console.log(`[Campaign Execution] ✅ Database connection test successful: ${testResult.rows[0]?.now}`);
    } catch (dbError) {
      console.error(`[Campaign Execution] ❌ Database connection test failed:`, dbError.message);
      console.error(`[Campaign Execution] Database error details:`, {
        code: dbError.code,
        detail: dbError.detail,
        hint: dbError.hint
      });
      throw new Error(`Database connection failed: ${dbError.message}`);
    }

    // Get campaign - don't filter by tenantId here, use the campaign's own tenant_id from DB
    // This allows scheduled service to process all running campaigns regardless of tenantId passed
    // Per TDD: Use lad_dev schema
    const schema = getSchema(req);
    let query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running'`;
    let params = [campaignId];

    // Try with is_deleted first, fallback without it
    try {
      query += ` AND is_deleted = FALSE`;
    } catch (e) {
      // is_deleted column might not exist, continue without it
    }
    
    console.log(`[Campaign Execution] 🔍 Querying campaign: ${query}`);
    console.log(`[Campaign Execution] 🔍 Params:`, params);

    let campaignResult;
    try {
      campaignResult = await pool.query(query, params);
    } catch (error) {
      // If is_deleted column doesn't exist, try without it
      if (error.message && error.message.includes('is_deleted')) {
        console.warn('[Campaign Execution] is_deleted column not found, trying without it');
        query = `SELECT * FROM ${schema}.campaigns WHERE id = $1 AND status = 'running'`;
        campaignResult = await pool.query(query, params);
      } else {
        throw error;
      }
    }

    if (campaignResult.rows.length === 0) {
      console.log(`[Campaign Execution] ❌ Campaign ${campaignId} not found or not running`);
      console.log(`[Campaign Execution] Query returned ${campaignResult.rows.length} rows`);
      return;
    }

    const campaign = campaignResult.rows[0];
    const userIdFromCampaign = campaign.created_by_user_id;
    const tenantIdFromCampaign = campaign.tenant_id;
    const executionState = campaign.execution_state || 'active';
    const nextRunAt = campaign.next_run_at;
    const lastLeadCheckAt = campaign.last_lead_check_at;

    console.log(`[Campaign Execution] ✅ Found campaign: ${campaign.name || 'unnamed'} (id: ${campaign.id})`);
    console.log(`[Campaign Execution] Campaign status: ${campaign.status}, execution_state: ${executionState}`);
    console.log(`[Campaign Execution] created_by_user_id: ${userIdFromCampaign}, tenant_id: ${tenantIdFromCampaign}`);

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
          console.log(`[Campaign Execution] ⏭️  ${reason}`);
          
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
          console.log(`[Campaign Execution] ⏭️  ${reason}`);
          
          await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
            lastExecutionReason: reason
          });
          
          return; // Skip execution
        }
      }
      
      // Retry time reached - reset to active and continue
      console.log(`[Campaign Execution] 🔄 Retry time reached, resuming campaign execution`);
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
          console.log(`[Campaign Execution] ⏭️  ${reason}`);
          
          await CampaignModel.updateExecutionState(campaignId, 'sleeping_until_next_day', {
            lastExecutionReason: reason
          });
          
          return; // Skip execution
        }
      }
      
      // Next day reached - reset to active and continue
      console.log(`[Campaign Execution] 🌅 Next day reached, resuming campaign execution`);
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        nextRunAt: null,
        lastExecutionReason: 'Next day reached, resuming execution'
      });
    }
    
    if (executionState === 'error') {
      // Error state - log but don't process (user should investigate)
      console.warn(`[Campaign Execution] ⚠️  Campaign in error state: ${campaign.last_execution_reason || 'Unknown error'}`);
      console.warn(`[Campaign Execution] ⚠️  Campaign will not process until error is resolved`);
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
        console.warn('[Campaign Execution] step_order column not found, trying order:', error.message);
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
            console.warn('[Campaign Execution] order column also not found, trying without ORDER BY:', orderError.message);
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
      console.log(`[Campaign Execution] ⚠️  Campaign ${campaignId} has no steps. Skipping execution.`);
      console.log(`[Campaign Execution] 💡 TIP: Steps must be created for the campaign before it can run.`);
      console.log(`[Campaign Execution] 💡 Check if steps were created when the campaign was created, or add steps via POST /api/campaigns/:id/steps`);
      
      // Debug: Check if steps exist with different tenant_id
      try {
        const debugResult = await pool.query(
          `SELECT COUNT(*) as count, tenant_id FROM ${schema}.campaign_steps WHERE campaign_id = $1 GROUP BY tenant_id`,
          [campaignId]
        );
        if (debugResult.rows.length > 0) {
          console.log(`[Campaign Execution] 🔍 DEBUG: Found steps with different tenant_ids:`, debugResult.rows);
        }
      } catch (debugError) {
        // Ignore debug errors
      }
      
      return;
    }

    console.log(`[Campaign Execution] Found ${steps.length} steps for campaign ${campaignId}`);

    // Find the lead generation step
    console.log(`[Campaign Execution] 🔍 Looking for lead_generation step. Available step types:`, steps.map(s => ({ 
      id: s.id, 
      type: s.step_type || s.type, 
      order: s.step_order || s.order 
    })));
    
    const leadGenerationStep = steps.find(s => (s.step_type || s.type) === 'lead_generation');
    
    // Declare leadGenResult outside the if block so it's accessible later
    let leadGenResult = null;

    if (leadGenerationStep) {
      console.log(`[Campaign Execution] ✅ Found lead generation step: ${leadGenerationStep.id} (order: ${leadGenerationStep.step_order || leadGenerationStep.order})`);
      console.log(`[Campaign Execution] Step config type: ${typeof leadGenerationStep.config}`);
      console.log(`[Campaign Execution] Step config preview: ${typeof leadGenerationStep.config === 'string' ? leadGenerationStep.config.substring(0, 200) : JSON.stringify(leadGenerationStep.config).substring(0, 200)}`);
      
      // Parse step config
      let stepWithParsedConfig = { ...leadGenerationStep };
      if (typeof leadGenerationStep.config === 'string') {
        try {
          stepWithParsedConfig.config = JSON.parse(leadGenerationStep.config);
          console.log(`[Campaign Execution] ✅ Successfully parsed step config`);
        } catch (parseErr) {
          console.error(`[Campaign Execution] ❌ Failed to parse lead generation step config:`, parseErr.message);
          stepWithParsedConfig.config = {};
        }
      } else if (leadGenerationStep.config) {
        stepWithParsedConfig.config = leadGenerationStep.config;
        console.log(`[Campaign Execution] ✅ Step config is already an object`);
      } else {
        console.warn(`[Campaign Execution] ⚠️  Step config is empty or null`);
        stepWithParsedConfig.config = {};
      }

      // Create a dummy lead object for the initial call to executeStepForLead
      // The actual leads will be generated and saved by executeLeadGeneration
      const dummyLead = { id: null, campaign_id: campaignId }; 

      console.log(`[Campaign Execution] 🚀 Executing lead generation...`);
      console.log(`[Campaign Execution] 🔑 Auth token available: ${authToken ? 'Yes' : 'No'}`);
      console.log(`[Campaign Execution] 👤 User ID: ${userIdFromCampaign}, Tenant ID: ${tenantIdFromCampaign}`);
      
      leadGenResult = await executeStepForLead(campaignId, stepWithParsedConfig, dummyLead, userIdFromCampaign, tenantIdFromCampaign, authToken);
      
      console.log(`[Campaign Execution] 📊 Lead generation result:`, JSON.stringify(leadGenResult, null, 2));

      if (!leadGenResult.success) {
        console.error(`[Campaign Execution] ❌ Lead generation failed for campaign ${campaignId}: ${leadGenResult.error}`);
        console.error(`[Campaign Execution] Full error details:`, leadGenResult);
        // Don't return here - continue processing existing leads even if generation failed
      } else {
        console.log(`[Campaign Execution] ✅ Lead generation completed successfully`);
        console.log(`[Campaign Execution] Leads found: ${leadGenResult.leadsFound || 0}, Leads saved: ${leadGenResult.leadsSaved || 0}`);
      }
    } else {
      console.log(`[Campaign Execution] ⚠️  No lead generation step found for campaign ${campaignId}. Skipping lead generation.`);
      console.log(`[Campaign Execution] Available steps:`, steps.map(s => ({ type: s.step_type || s.type, title: s.title || 'no title' })));
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
        console.warn('[Campaign Execution] snapshot column not found, trying without it:', error.message);
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
            console.warn('[Campaign Execution] is_deleted column also not found, trying without both:', error2.message);
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
        console.warn('[Campaign Execution] is_deleted column not found, trying without it:', error.message);
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
            console.warn('[Campaign Execution] snapshot column also not found, trying without both:', error2.message);
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
    
    console.log(`[Campaign Execution] Processed ${leads.length} leads for campaign ${campaignId}`);
    
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
      
      console.log(`[Campaign Execution] 💤 Campaign set to 'sleeping_until_next_day' AFTER processing all leads. Resumes: ${tomorrow.toISOString()}`);
    } else if (!leadGenResult || !leadGenResult.success) {
      // If lead generation didn't run or failed, but we have existing leads, keep active
      // This handles the case where campaigns have leads but no lead generation step
      if (leads.length > 0) {
        console.log(`[Campaign Execution] ✅ Campaign has ${leads.length} leads to process. Keeping active.`);
        await CampaignModel.updateExecutionState(campaignId, 'active', {
          lastExecutionReason: `Processing ${leads.length} existing leads through workflow.`
        });
      }
    }
  } catch (error) {
    console.error(`[Campaign Execution] Error processing campaign ${campaignId}:`, error);
  }
}

module.exports = {
  executeStepForLead,
  processCampaign
};

