/**
 * Lead Generation Helpers
 * Helper functions for lead generation service
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
/**
 * Check if lead already exists in campaign
 */
async function checkLeadExists(campaignId, apolloPersonId, req = null) {
  try {
    // Per TDD: Use dynamic schema
    const schema = getSchema(req);
    const existingLead = await pool.query(
      `SELECT id FROM ${schema}.campaign_leads 
       WHERE campaign_id = $1 AND lead_data->>'apollo_person_id' = $2 AND is_deleted = FALSE`,
      [campaignId, String(apolloPersonId)]
    );
    return existingLead.rows.length > 0 ? existingLead.rows[0] : null;
  } catch (err) {
    throw err;
  }
}
/**
 * Extract lead fields from employee data
 */
function extractLeadFields(employee) {
  const nameParts = (employee.name || employee.employee_name || '').split(' ');
  return {
    firstName: nameParts[0] || employee.first_name || null,
    lastName: nameParts.slice(1).join(' ') || employee.last_name || null,
    email: employee.email || employee.employee_email || employee.work_email || null,
    linkedinUrl: employee.linkedin_url || employee.employee_linkedin_url || employee.linkedin || null,
    companyName: employee.company_name || employee.organization?.name || employee.company?.name || null,
    title: employee.title || employee.job_title || employee.employee_title || employee.headline || null,
    phone: employee.phone || employee.employee_phone || employee.phone_number || null
  };
}
/**
 * Create snapshot JSONB from lead fields
 */
function createSnapshot(fields) {
  return JSON.stringify({
    first_name: fields.firstName,
    last_name: fields.lastName,
    email: fields.email,
    linkedin_url: fields.linkedinUrl,
    company_name: fields.companyName,
    title: fields.title,
    phone: fields.phone
  });
}
/**
 * Save lead to campaign
 */
async function saveLeadToCampaign(campaignId, tenantId, leadId, snapshot, leadData, req = null) {
  const schema = getSchema(null);
  
  // Verify lead exists before trying to insert campaign_lead
  const verifyResult = await pool.query(
    `SELECT id FROM ${schema}.leads WHERE tenant_id = $1 AND id = $2`,
    [tenantId, leadId]
  );
  
  if (verifyResult.rows.length === 0) {
    const error = new Error(`Lead ${leadId} not found in leads table for tenant ${tenantId}`);
    logger.error('[saveLeadToCampaign] Lead verification failed', {
      tenantId,
      leadId,
      campaignId
    });
    throw error;
  }
  
  logger.info('[saveLeadToCampaign] Lead verified, inserting campaign_lead', {
    tenantId,
    leadId,
    campaignId
  });
  
  // Extract fields from leadData for individual columns
  const firstName = leadData.first_name || null;
  const lastName = leadData.last_name || null;
  const email = leadData.email || null;
  const linkedinUrl = leadData.linkedin_url || null;
  const companyName = leadData.company_name || null;
  const title = leadData.title || null;
  const phone = leadData.phone || null;
  
  const insertResult = await pool.query(
    `INSERT INTO ${schema}.campaign_leads 
     (tenant_id, campaign_id, lead_id, status, snapshot, lead_data, 
      first_name, last_name, email, linkedin_url, company_name, title, phone, created_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
     RETURNING id`,
    [tenantId, campaignId, leadId, snapshot, JSON.stringify(leadData),
     firstName, lastName, email, linkedinUrl, companyName, title, phone]
  );
  return insertResult.rows[0].id;
}
/**
 * Update campaign config with offset and date
 */
async function updateCampaignConfig(campaignId, config, req = null, tenantId = null) {
  try {
    // Per TDD: Use dynamic schema
    const schema = getSchema(req);
    const actualTenantId = tenantId || req?.user?.tenant_id || req?.user?.tenantId;
    if (!actualTenantId) {
      throw new Error('Tenant context required for campaign config update');
    }
    await pool.query(
      `UPDATE ${schema}.campaigns SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(config), campaignId, actualTenantId]
    );
  } catch (updateError) {
    // If config column doesn't exist or update fails, log but don't throw
    throw updateError;
  }
}
/**
 * Update step config with offset and date
 */
async function updateStepConfig(stepId, stepConfig, req = null, tenantId = null) {
  try {
    // Per TDD: Use dynamic schema
    const schema = getSchema(req);
    const actualTenantId = tenantId || req?.user?.tenant_id || req?.user?.tenantId;
    if (!actualTenantId) {
      throw new Error('Tenant context required for step config update');
    }
    await pool.query(
      `UPDATE ${schema}.campaign_steps SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(stepConfig), stepId, actualTenantId]
    );
  } catch (stepUpdateErr) {
    throw stepUpdateErr;
  }
}
module.exports = {
  checkLeadExists,
  extractLeadFields,
  createSnapshot,
  saveLeadToCampaign,
  updateCampaignConfig,
  updateStepConfig
};
