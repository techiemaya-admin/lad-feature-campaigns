/**
 * Step Executors
 * Handles execution of various campaign step types
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../utils/schema');
const axios = require('axios');
const logger = require('../utils/logger');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be set');
}

/**
 * Helper function to get lead data from campaign_leads table
 * Tries lead_data first, falls back to custom_fields if lead_data doesn't exist
 */
// Per TDD: Use dynamic schema
async function getLeadData(campaignLeadId, req = null) {
  try {
    const schema = getSchema(req);
    const leadDataResult = await pool.query(
      `SELECT lead_data, snapshot FROM ${schema}.campaign_leads WHERE id = $1 AND is_deleted = FALSE`,
      [campaignLeadId]
    );
    
    if (leadDataResult.rows.length === 0) {
      return null;
    }
    
    const row = leadDataResult.rows[0];
    // Prefer lead_data, fallback to snapshot
    const leadData = row.lead_data || row.snapshot || {};
    
    return typeof leadData === 'string' ? JSON.parse(leadData) : leadData;
  } catch (err) {
    logger.error('[StepExecutors] Error getting lead data', { error: err.message, stack: err.stack });
    throw err;
  }
}

/**
 * Execute email step
 */
async function executeEmailStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    logger.info('[Campaign Execution] Executing email step', { stepType });
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const email = leadData.email || leadData.employee_email;
    if (!email) {
      return { success: false, error: 'Email not found for lead' };
    }
    
    const subject = stepConfig.subject || stepConfig.emailSubject || 'Re: {{company_name}}';
    const body = stepConfig.body || stepConfig.emailBody || stepConfig.message || 'Hi {{first_name}},...';
    
    // TODO: Implement actual email sending via SMTP or email service
    logger.debug('[Campaign Execution] Email step recorded - would send', { email });
    
    return { success: true, email, subject, body };
  } catch (error) {
    logger.error('[Campaign Execution] Email step error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Execute WhatsApp step
 */
async function executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    logger.info('[Campaign Execution] Executing WhatsApp step', { stepType });
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const phone = leadData.phone || leadData.employee_phone;
    if (!phone) {
      return { success: false, error: 'Phone number not found for lead' };
    }
    
    const message = stepConfig.whatsappMessage || stepConfig.message || 'Hi {{first_name}},...';
    
    // TODO: Implement actual WhatsApp sending
    logger.debug('[Campaign Execution] WhatsApp step recorded - would send', { phone });
    
    return { success: true, phone, message };
  } catch (error) {
    logger.error('[Campaign Execution] WhatsApp step error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Execute Instagram step
 */
async function executeInstagramStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    logger.info('[Campaign Execution] Executing Instagram step', { stepType });
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    // TODO: Implement actual Instagram actions
    logger.debug('[Campaign Execution] Instagram step recorded', { stepType });
    
    return { success: true, stepType };
  } catch (error) {
    logger.error('[Campaign Execution] Instagram step error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Execute voice agent step
 */
async function executeVoiceAgentStep(stepConfig, campaignLead, userId, tenantId) {
  try {
    logger.info('[Campaign Execution] Executing voice agent step');
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const phone = leadData.phone || leadData.employee_phone;
    if (!phone) {
      return { success: false, error: 'Phone number not found for lead' };
    }
    
    const leadName = leadData.name || leadData.employee_name || 'there';
    const agentId = stepConfig.voiceAgentId || stepConfig.agent_id;
    const addedContext = stepConfig.voiceContext || stepConfig.added_context || '';
    
    // Call voice agent API (internal call, no auth needed)
    const response = await axios.post(
      `${BACKEND_URL}/api/voiceagents/calls`,
      {
        agent_id: agentId,
        to_number: phone,
        lead_name: leadName,
        added_context: addedContext,
        initiated_by: userId
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );
    
    if (response.data && response.data.success !== false) {
      return { success: true };
    } else {
      return { success: false, error: response.data?.error || 'Failed to initiate call' };
    }
  } catch (error) {
    logger.error('[Campaign Execution] Voice agent step error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Execute delay step
 */
async function executeDelayStep(stepConfig) {
  const delayDays = stepConfig.delay_days || stepConfig.delayDays || 0;
  const delayHours = stepConfig.delay_hours || stepConfig.delayHours || 0;
  const totalMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000);
  
  logger.debug('[Campaign Execution] Delaying', { delayDays, delayHours });
  
  // In a real implementation, you'd schedule this for later
  // For now, we'll just return success (the delay should be handled by the scheduler)
  return { success: true, delayMs: totalMs };
}

/**
 * Execute condition step
 */
async function executeConditionStep(stepConfig, campaignLead) {
  const conditionType = stepConfig.condition || stepConfig.conditionType;
  
  // Per TDD: Use dynamic schema
  const schema = getSchema(null);
  const activitiesResult = await pool.query(
    `SELECT status FROM ${schema}.campaign_lead_activities 
     WHERE campaign_lead_id = $1 AND is_deleted = FALSE
     ORDER BY created_at DESC LIMIT 10`,
    [campaignLead.id]
  );
  
  const activities = activitiesResult.rows;
  let conditionMet = false;
  
  switch (conditionType) {
    case 'connected':
      conditionMet = activities.some(a => a.status === 'connected');
      break;
    case 'replied':
      conditionMet = activities.some(a => a.status === 'replied');
      break;
    case 'opened':
      conditionMet = activities.some(a => a.status === 'opened');
      break;
    default:
      conditionMet = true; // Default to true if condition type unknown
  }
  
  return { success: true, conditionMet };
}

module.exports = {
  getLeadData,
  executeEmailStep,
  executeWhatsAppStep,
  executeInstagramStep,
  executeVoiceAgentStep,
  executeDelayStep,
  executeConditionStep
};

