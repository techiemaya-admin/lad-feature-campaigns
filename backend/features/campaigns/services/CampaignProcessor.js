/**
 * Campaign Processor
 * Handles main campaign processing and step execution
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
 */
const { pool } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');
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
async function executeStepForLead(campaignId, step, campaignLead, userId, tenantId, authToken = null) {
  // Declare activityId outside try block so it's accessible in catch
  let activityId = null;
  
  logger.info('[executeStepForLead] Starting step execution', {
    campaignId,
    stepType: step.step_type || step.type,
    hasAuthToken: !!authToken
  });
  
  try {
    const stepType = step.step_type || step.type;
    const stepConfig = typeof step.config === 'string' ? JSON.parse(step.config) : step.config;
    
    logger.info('[executeStepForLead] Step config parsed', {
      campaignId,
      stepType,
      configKeys: Object.keys(stepConfig || {})
    });
    
    // VALIDATE: Check if all required fields are filled before executing
    const validation = validateStepConfig(stepType, stepConfig);
    
    logger.info('[executeStepForLead] Validation result', {
      campaignId,
      stepType,
      valid: validation.valid,
      error: validation.error,
      missingFields: validation.missingFields
    });
    
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
      const schema = getSchema();
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
      logger.info('[executeStepForLead] Calling executeLeadGeneration', {
        campaignId,
        userId,
        tenantId,
        hasAuthToken: !!authToken
      });
      result = await executeLeadGeneration(campaignId, step, stepConfig, userId, tenantId, authToken);
      logger.info('[executeStepForLead] executeLeadGeneration returned', {
        campaignId,
        success: result.success,
        leadCount: result.leadCount || 0,
        error: result.error
      });
    } else if (stepType && stepType.startsWith('linkedin_')) {
      // All LinkedIn steps: connect, message, follow, visit, scrape_profile, company_search, employee_list, autopost, comment_reply
      logger.info('[executeStepForLead] Calling executeLinkedInStep', {
        campaignId,
        stepType,
        userId,
        tenantId,
        campaignLeadId: campaignLead?.id
      });
      result = await executeLinkedInStep(stepType, stepConfig, campaignLead, userId, tenantId);
      logger.info('[executeStepForLead] executeLinkedInStep returned', {
        campaignId,
        stepType,
        success: result?.success,
        error: result?.error
      });
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
  const logger = require('../../../core/utils/logger');
  
  logger.info('[CampaignProcessor] processCampaign called', { 
    campaignId, 
    tenantId,
    hasAuthToken: !!authToken 
  });
  
  try {
    // Test database connection first
    try {
      const testResult = await pool.query('SELECT NOW() as now');
      logger.info('[CampaignProcessor] Database connection test passed');
    } catch (dbError) {
      logger.error('[CampaignProcessor] Database connection test failed', { error: dbError.message });
      throw new Error(`Database connection failed: ${dbError.message}`);
    }
    
    logger.info('[CampaignProcessor] Starting campaign query', { campaignId, tenantId });
    
    // Get campaign - don't filter by tenantId here, use the campaign's own tenant_id from DB
    // This allows scheduled service to process all running campaigns regardless of tenantId passed
    // Per TDD: Use dynamic schema resolution based on tenantId
    // Create a mock req object for schema resolution if tenantId is available
    const schema = getSchema(null); // No req available in this context
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
    
    logger.info('[CampaignProcessor] Campaign query result', { 
      campaignId, 
      found: campaignResult.rows.length > 0,
      schema 
    });
    
    if (campaignResult.rows.length === 0) {
      logger.warn('[CampaignProcessor] Campaign not found or not running', { campaignId, tenantId, schema });
      return { success: false, skipped: true, reason: 'Campaign not found or not running', campaignId, leadCount: 0 };
    }
    const campaign = campaignResult.rows[0];
    const userIdFromCampaign = campaign.created_by_user_id;
    const tenantIdFromCampaign = campaign.tenant_id;
    const executionState = campaign.execution_state || 'active';
    const nextRunAt = campaign.next_run_at;
    const lastLeadCheckAt = campaign.last_lead_check_at;
    
    logger.info('[CampaignProcessor] Campaign details', {
      campaignId,
      executionState,
      nextRunAt,
      lastLeadCheckAt,
      status: campaign.status
    });
    
    // PRODUCTION-GRADE: Check execution state before processing
    // This prevents unnecessary retries and wasted compute
    const now = new Date();
    if (executionState === 'waiting_for_leads') {
      logger.info('[CampaignProcessor] Campaign in waiting_for_leads state', { campaignId });
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
      logger.info('[CampaignProcessor] Campaign sleeping until next day', { campaignId, nextRunAt });
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
      logger.warn('[CampaignProcessor] Campaign in error state, skipping', { campaignId });
      // Error state - log but don't process (user should investigate)
      return { success: false, skipped: true, reason: 'Campaign in error state', campaignId, leadCount: 0 }; // Skip execution
    }
    
    logger.info('[CampaignProcessor] Execution state checks passed, proceeding with processing', { 
      campaignId, 
      executionState 
    });
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
    
    logger.info('[CampaignProcessor] Steps retrieved', { 
      campaignId, 
      stepsCount: steps.length,
      stepTypes: steps.map(s => s.step_type || s.type)
    });
    
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
    
    logger.info('[CampaignProcessor] Lead generation check', { 
      campaignId,
      hasLeadGenStep: !!leadGenerationStep,
      isInbound: isInboundCampaign
    });
    
    // Declare leadGenResult outside the if block so it's accessible later
    let leadGenResult = null;
    // Skip lead generation for inbound campaigns - leads are already uploaded
    if (leadGenerationStep && !isInboundCampaign) {
      logger.info('[CampaignProcessor] Executing lead generation', { campaignId });
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
      
      // Parse leadGenerationFilters if it's a JSON string (UI double-encoding issue)
      if (stepWithParsedConfig.config.leadGenerationFilters && 
          typeof stepWithParsedConfig.config.leadGenerationFilters === 'string') {
        try {
          stepWithParsedConfig.config.leadGenerationFilters = JSON.parse(stepWithParsedConfig.config.leadGenerationFilters);
          logger.info('[CampaignProcessor] Parsed leadGenerationFilters from string', {
            campaignId,
            parsedFilters: stepWithParsedConfig.config.leadGenerationFilters
          });
        } catch (parseErr) {
          logger.error('[CampaignProcessor] Failed to parse leadGenerationFilters', {
            campaignId,
            error: parseErr.message,
            filterValue: stepWithParsedConfig.config.leadGenerationFilters
          });
          stepWithParsedConfig.config.leadGenerationFilters = {};
        }
      }
      
      // Merge campaign-level config into step config for lead generation
      // This allows search_filters, apollo_api_key, and daily_lead_limit from campaign config
      if (campaignConfig) {
        logger.info('[CampaignProcessor] Campaign config for lead gen', {
          campaignId,
          configKeys: Object.keys(campaignConfig),
          hasSearchFilters: !!campaignConfig.search_filters,
          campaignConfig: campaignConfig
        });
        
        // If campaign has search_filters, spread them directly (Apollo API format)
        const campaignSearchFilters = campaignConfig.search_filters || {};
        
        stepWithParsedConfig.config = {
          ...stepWithParsedConfig.config,
          // Spread all search filter fields directly (q_organization_keyword_tags, organization_num_employees_ranges, etc.)
          ...campaignSearchFilters,
          // Only override leadGenerationFilters if campaign has actual search_filters (not empty object)
          ...(Object.keys(campaignSearchFilters).length > 0 && { leadGenerationFilters: campaignSearchFilters }),
          // Add daily_lead_limit from campaign config if not in step config
          ...(campaignConfig.daily_lead_limit && { leadGenerationLimit: campaignConfig.daily_lead_limit }),
          // Add apollo_api_key from campaign config if not in step config
          ...(campaignConfig.apollo_api_key && !stepWithParsedConfig.config.apollo_api_key && { apollo_api_key: campaignConfig.apollo_api_key })
        };
      }
      
      // Create a dummy lead object for the initial call to executeStepForLead
      // The actual leads will be generated and saved by executeLeadGeneration
      const dummyLead = { id: null, campaign_id: campaignId }; 
      leadGenResult = await executeStepForLead(campaignId, stepWithParsedConfig, dummyLead, userIdFromCampaign, tenantIdFromCampaign, authToken);
      
      logger.info('[CampaignProcessor] Lead generation completed', { 
        campaignId,
        success: leadGenResult?.success,
        leadCount: leadGenResult?.leadCount || 0
      });
      
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
      // Filter leads based on campaign type to prevent mixing inbound and outbound
      let leadsQuery = `
        SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
        FROM ${schema}.campaign_leads 
        WHERE campaign_id = $1 
        AND status IN ('pending', 'active') 
        AND is_deleted = FALSE
      `;
      
      // Add campaign type filter to block wrong type of leads
      if (isInboundCampaign) {
        // For inbound campaigns: only process leads with lead_id and NO lead_data/snapshot
        leadsQuery += ` AND lead_id IS NOT NULL 
                        AND (lead_data IS NULL OR lead_data = '{}'::jsonb OR lead_data::text = 'null')
                        AND (snapshot IS NULL OR snapshot = '{}'::jsonb OR snapshot::text = 'null')`;
      } else {
        // For outbound campaigns: only process leads with lead_data or snapshot (blocks inbound leads)
        leadsQuery += ` AND (lead_data IS NOT NULL AND lead_data != '{}'::jsonb AND lead_data::text != 'null'
                        OR snapshot IS NOT NULL AND snapshot != '{}'::jsonb AND snapshot::text != 'null')`;
      }
      
      leadsResult = await pool.query(leadsQuery, [campaignId]);
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      // If snapshot column doesn't exist, try without it
      if (errorMsg.includes('snapshot') || errorMsg.includes('column') && errorMsg.includes('does not exist')) {
        try {
          let leadsQuery = `
            SELECT id, campaign_id, lead_id, status, lead_data 
            FROM ${schema}.campaign_leads 
            WHERE campaign_id = $1 
            AND status IN ('pending', 'active') 
            AND is_deleted = FALSE
          `;
          
          // Add campaign type filter
          if (isInboundCampaign) {
            leadsQuery += ` AND lead_id IS NOT NULL 
                            AND (lead_data IS NULL OR lead_data = '{}'::jsonb OR lead_data::text = 'null')`;
          } else {
            leadsQuery += ` AND (lead_data IS NOT NULL AND lead_data != '{}'::jsonb AND lead_data::text != 'null')`;
          }
          
          leadsResult = await pool.query(leadsQuery, [campaignId]);
        } catch (error2) {
          // If is_deleted column also doesn't exist, try without both
          if (error2.message && error2.message.includes('is_deleted')) {
            let leadsQuery = `
              SELECT id, campaign_id, lead_id, status, lead_data 
              FROM ${schema}.campaign_leads 
              WHERE campaign_id = $1 
              AND status IN ('pending', 'active')
            `;
            
            // Add campaign type filter
            if (isInboundCampaign) {
              leadsQuery += ` AND lead_id IS NOT NULL 
                              AND (lead_data IS NULL OR lead_data = '{}'::jsonb OR lead_data::text = 'null')`;
            } else {
              leadsQuery += ` AND (lead_data IS NOT NULL AND lead_data != '{}'::jsonb AND lead_data::text != 'null')`;
            }
            
            leadsResult = await pool.query(leadsQuery, [campaignId]);
          } else {
            throw error2;
          }
        }
      } else if (errorMsg.includes('is_deleted')) {
        // If only is_deleted is missing, try without it but keep snapshot
        try {
          let leadsQuery = `
            SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
            FROM ${schema}.campaign_leads 
            WHERE campaign_id = $1 
            AND status IN ('pending', 'active')
          `;
          
          // Add campaign type filter
          if (isInboundCampaign) {
            leadsQuery += ` AND lead_id IS NOT NULL 
                            AND (lead_data IS NULL OR lead_data = '{}'::jsonb OR lead_data::text = 'null')
                            AND (snapshot IS NULL OR snapshot = '{}'::jsonb OR snapshot::text = 'null')`;
          } else {
            leadsQuery += ` AND (lead_data IS NOT NULL AND lead_data != '{}'::jsonb AND lead_data::text != 'null'
                            OR snapshot IS NOT NULL AND snapshot != '{}'::jsonb AND snapshot::text != 'null')`;
          }
          
          leadsResult = await pool.query(leadsQuery, [campaignId]);
        } catch (error2) {
          // If snapshot also doesn't exist, try without both
          if (error2.message && error2.message.includes('snapshot')) {
            let leadsQuery = `
              SELECT id, campaign_id, lead_id, status, lead_data 
              FROM ${schema}.campaign_leads 
              WHERE campaign_id = $1 
              AND status IN ('pending', 'active')
            `;
            
            // Add campaign type filter
            if (isInboundCampaign) {
              leadsQuery += ` AND lead_id IS NOT NULL 
                              AND (lead_data IS NULL OR lead_data = '{}'::jsonb OR lead_data::text = 'null')`;
            } else {
              leadsQuery += ` AND (lead_data IS NOT NULL AND lead_data != '{}'::jsonb AND lead_data::text != 'null')`;
            }
            
            leadsResult = await pool.query(leadsQuery, [campaignId]);
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
    logger.error('[CampaignProcessor] processCampaign failed', { 
      campaignId, 
      tenantId,
      error: error.message,
      stack: error.stack
    });
    throw error; // Re-throw to properly reject the promise
  }
}
module.exports = {
  executeStepForLead,
  processCampaign
};
