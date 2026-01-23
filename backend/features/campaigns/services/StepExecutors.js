/**
 * Step Executors
 * Handles execution of various campaign step types
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const axios = require('axios');
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be set');
}
/**
 * Helper function to get lead data from campaign_leads table
 * Tries lead_data first, falls back to custom_fields if lead_data doesn't exist
 */
// Per TDD: Use dynamic schema
async function getLeadData(campaignLeadId, req = null, tenantId = null) {
  try {
    const schema = getSchema(req);
    // Get tenant_id from req or parameter
    const actualTenantId = tenantId || req?.user?.tenant_id || req?.user?.tenantId;
    let leadDataResult;
    // If we have tenantId, use it for tenant-scoped query
    if (actualTenantId) {
      try {
        // First try to get campaign_lead with lead_id
        leadDataResult = await pool.query(
          `SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
           FROM ${schema}.campaign_leads cl
           WHERE cl.id = $1 AND cl.tenant_id = $2 AND cl.is_deleted = FALSE`,
          [campaignLeadId, actualTenantId]
        );
      } catch (err) {
        // If is_deleted column doesn't exist, try without it
        if (err.message && err.message.includes('is_deleted')) {
          leadDataResult = await pool.query(
            `SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
             FROM ${schema}.campaign_leads cl
             WHERE cl.id = $1 AND cl.tenant_id = $2`,
            [campaignLeadId, actualTenantId]
          );
        } else {
          throw err;
        }
      }
    } else {
      // No tenantId provided - try to get lead by ID only (less secure, but allows backward compatibility)
      // This should only happen in legacy code paths
      try {
        leadDataResult = await pool.query(
          `SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
           FROM ${schema}.campaign_leads cl
           WHERE cl.id = $1 AND cl.is_deleted = FALSE`,
          [campaignLeadId]
        );
      } catch (err) {
        if (err.message && err.message.includes('is_deleted')) {
          leadDataResult = await pool.query(
            `SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
             FROM ${schema}.campaign_leads cl
             WHERE cl.id = $1`,
            [campaignLeadId]
          );
        } else {
          throw err;
        }
      }
    }
    if (leadDataResult.rows.length === 0) {
      return null;
    }
    const row = leadDataResult.rows[0];
    // PRIORITY: For inbound campaigns, fetch data from leads table using lead_id
    // For outbound campaigns (Apollo scraping), use lead_data from campaign_leads
    let leadData;
    if (row.lead_id) {
      // Inbound campaign: Try to fetch lead data from leads table
      try {
        const leadsTableResult = await pool.query(
          `SELECT first_name, last_name, email, linkedin_url, company_name, title, phone 
           FROM ${schema}.leads 
           WHERE id = $1 AND tenant_id = $2`,
          [row.lead_id, row.tenant_id]
        );
        if (leadsTableResult.rows.length > 0) {
          const leadRecord = leadsTableResult.rows[0];
          leadData = {
            linkedin_url: leadRecord.linkedin_url,
            name: [leadRecord.first_name, leadRecord.last_name].filter(Boolean).join(' '),
            first_name: leadRecord.first_name,
            last_name: leadRecord.last_name,
            email: leadRecord.email,
            company: leadRecord.company_name,
            company_name: leadRecord.company_name,
            title: leadRecord.title,
            phone: leadRecord.phone
          };
            campaignLeadId, 
            leadId: row.lead_id,
            hasLinkedInUrl: !!leadData.linkedin_url,
            hasName: !!leadData.name,
            hasEmail: !!leadData.email
          });
        } else {
          // Fallback to campaign_leads data if exists
          leadData = row.lead_data || row.snapshot || {};
          leadData = typeof leadData === 'string' ? JSON.parse(leadData) : leadData;
        }
      } catch (leadsFetchError) {
          error: leadsFetchError.message,
          leadId: row.lead_id
        });
        // Fallback to campaign_leads data
        leadData = row.lead_data || row.snapshot || {};
        leadData = typeof leadData === 'string' ? JSON.parse(leadData) : leadData;
      }
    } else if (row.lead_data || row.snapshot) {
      // Outbound campaign: Lead data is in campaign_leads table
      leadData = row.lead_data || row.snapshot || {};
      leadData = typeof leadData === 'string' ? JSON.parse(leadData) : leadData;
        campaignLeadId,
        hasData: !!row.lead_data,
        hasSnapshot: !!row.snapshot
      });
    } else {
      // No data found in either location
        campaignLeadId,
        hasLeadId: !!row.lead_id,
        hasLeadData: !!row.lead_data,
        hasSnapshot: !!row.snapshot
      });
      return null;
    }
    return leadData;
  } catch (err) {
    throw err;
  }
}
/**
 * Execute email step
 */
async function executeEmailStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    // Get lead data
    const leadData = await getLeadData(campaignLead.id, null, tenantId);
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
    return { success: true, email, subject, body };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
/**
 * Execute WhatsApp step
 */
async function executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    // Get lead data
    const leadData = await getLeadData(campaignLead.id, null, tenantId);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    const phone = leadData.phone || leadData.employee_phone;
    if (!phone) {
      return { success: false, error: 'Phone number not found for lead' };
    }
    const message = stepConfig.whatsappMessage || stepConfig.message || 'Hi {{first_name}},...';
    // TODO: Implement actual WhatsApp sending
    return { success: true, phone, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
/**
 * Execute Instagram step
 */
async function executeInstagramStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    // Get lead data
    const leadData = await getLeadData(campaignLead.id, null, tenantId);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    // TODO: Implement actual Instagram actions
    return { success: true, stepType };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
/**
 * Execute voice agent step
 */
async function executeVoiceAgentStep(stepConfig, campaignLead, userId, tenantId) {
  try {
    // Get lead data
    const leadData = await getLeadData(campaignLead.id, null, tenantId);
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
  const schema = getSchema(req);
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
