/**
 * Campaign Processor
 * Handles main campaign processing and step execution
 * Note: processLeadThroughWorkflow has been moved to WorkflowProcessor.js
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
const { processLeadThroughWorkflow } = require('./WorkflowProcessor');

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
      // Per TDD: Use lad_dev schema, need tenant_id and campaign_id
      // Get tenant_id from campaign
      const campaignQuery = await pool.query(
        `SELECT tenant_id FROM lad_dev.campaigns WHERE id = $1 AND is_deleted = FALSE`,
        [campaignId]
      );
      
      if (campaignQuery.rows.length > 0) {
        const tenantId = campaignQuery.rows[0].tenant_id;
        const activityResult = await pool.query(
          `INSERT INTO lad_dev.campaign_lead_activities 
           (tenant_id, campaign_id, campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, CURRENT_TIMESTAMP)
           RETURNING id`,
          [tenantId, campaignId, campaignLead.id, step.id, stepType, stepType, getChannelForStepType(stepType)]
        );
        
        activityId = activityResult.rows[0].id;
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
      // Per TDD: Use lad_dev schema
      await pool.query(
        `UPDATE lad_dev.campaign_lead_activities 
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
        // Per TDD: Use lad_dev schema
        await pool.query(
          `UPDATE lad_dev.campaign_lead_activities 
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

    // Get campaign - include tenantId if provided for multi-tenant isolation
    // Per TDD: Use lad_dev schema
    let query = `SELECT * FROM lad_dev.campaigns WHERE id = $1 AND status = 'running' AND is_deleted = FALSE`;
    let params = [campaignId];

    if (tenantId) {
      query += ` AND tenant_id = $2`;
      params.push(tenantId);
    }
    
    console.log(`[Campaign Execution] 🔍 Querying campaign: ${query}`);
    console.log(`[Campaign Execution] 🔍 Params:`, params);

    const campaignResult = await pool.query(query, params);

    if (campaignResult.rows.length === 0) {
      console.log(`[Campaign Execution] ❌ Campaign ${campaignId} not found or not running`);
      console.log(`[Campaign Execution] Query returned ${campaignResult.rows.length} rows`);
      return;
    }

    const campaign = campaignResult.rows[0];
    const userIdFromCampaign = campaign.created_by_user_id;
    const tenantIdFromCampaign = campaign.tenant_id;

    console.log(`[Campaign Execution] ✅ Found campaign: ${campaign.name || 'unnamed'} (id: ${campaign.id})`);
    console.log(`[Campaign Execution] Campaign status: ${campaign.status}, created_by_user_id: ${userIdFromCampaign}, tenant_id: ${tenantIdFromCampaign}`);

    // Get campaign steps in order
    // Per TDD: Use lad_dev schema and step_order column
    const stepsResult = await pool.query(
      `SELECT * FROM lad_dev.campaign_steps 
       WHERE campaign_id = $1 
       ORDER BY step_order ASC`,
      [campaignId]
    );
    const steps = stepsResult.rows;

    if (steps.length === 0) {
      console.log(`[Campaign Execution] ⚠️  Campaign ${campaignId} has no steps. Skipping execution.`);
      return;
    }

    console.log(`[Campaign Execution] Found ${steps.length} steps for campaign ${campaignId}`);

    // Find the lead generation step
    const leadGenerationStep = steps.find(s => (s.step_type || s.type) === 'lead_generation');

    if (leadGenerationStep) {
      console.log(`[Campaign Execution] Found lead generation step: ${leadGenerationStep.id} (order: ${leadGenerationStep.step_order || leadGenerationStep.order})`);
      
      // Parse step config
      let stepWithParsedConfig = { ...leadGenerationStep };
      if (typeof leadGenerationStep.config === 'string') {
        try {
          stepWithParsedConfig.config = JSON.parse(leadGenerationStep.config);
        } catch (parseErr) {
          console.error(`[Campaign Execution] Failed to parse lead generation step config:`, parseErr.message);
          stepWithParsedConfig.config = {};
        }
      }

      // Create a dummy lead object for the initial call to executeStepForLead
      // The actual leads will be generated and saved by executeLeadGeneration
      const dummyLead = { id: null, campaign_id: campaignId }; 

      console.log(`[Campaign Execution] 🚀 Executing lead generation...`);
      console.log(`[Campaign Execution] 🔑 Auth token available: ${authToken ? 'Yes' : 'No'}`);
      const leadGenResult = await executeStepForLead(campaignId, stepWithParsedConfig, dummyLead, userIdFromCampaign, tenantIdFromCampaign, authToken);
      
      console.log(`[Campaign Execution] Lead generation result:`, JSON.stringify(leadGenResult, null, 2));

      if (!leadGenResult.success) {
        console.error(`[Campaign Execution] ❌ Lead generation failed for campaign ${campaignId}: ${leadGenResult.error}`);
        // Optionally update campaign status to 'error' or log more details
        return;
      }
    } else {
      console.log(`[Campaign Execution] ℹ️  No lead generation step found for campaign ${campaignId}. Skipping lead generation.`);
    }

    // Fetch leads for the campaign (after potential lead generation)
    // Per TDD: Use lad_dev schema
    const leadsResult = await pool.query(
      `SELECT id, campaign_id, lead_id, status, snapshot, lead_data 
       FROM lad_dev.campaign_leads 
       WHERE campaign_id = $1 
       AND status = 'active' 
       AND is_deleted = FALSE`,
      [campaignId]
    );
    
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
  } catch (error) {
    console.error(`[Campaign Execution] Error processing campaign ${campaignId}:`, error);
  }
}

module.exports = {
  executeStepForLead,
  processCampaign
};

