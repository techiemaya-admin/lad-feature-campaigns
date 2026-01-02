/**
 * Lead Generation Helpers
 * Helper functions for lead generation service
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../utils/schema');

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
    logger.error('[Lead Generation] Error checking for existing lead', { error: err.message, stack: err.stack });
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
  const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
  const insertResult = await pool.query(
    `INSERT INTO ${schema}.campaign_leads 
     (tenant_id, campaign_id, lead_id, status, snapshot, lead_data, created_at)
     VALUES ($1, $2, $3, 'active', $4, $5, CURRENT_TIMESTAMP)
     RETURNING id`,
    [tenantId, campaignId, leadId, snapshot, JSON.stringify(leadData)]
  );
  return insertResult.rows[0].id;
}

/**
 * Update campaign config with offset and date
 */
async function updateCampaignConfig(campaignId, config, tenantId = null, req = null) {
  try {
    // Per TDD: Use dynamic schema with tenantId
    const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
    await pool.query(
      `UPDATE ${schema}.campaigns SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(config), campaignId]
    );
  } catch (updateError) {
    // If config column doesn't exist or update fails, log but don't throw
    logger.warn('[Lead Generation] Could not update campaign config', { error: updateError.message, campaignId });
    throw updateError;
  }
}

/**
 * Update step config with offset and date
 */
async function updateStepConfig(stepId, stepConfig, tenantId = null, req = null) {
  try {
    // Per TDD: Use dynamic schema with tenantId
    const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(req);
    await pool.query(
      `UPDATE ${schema}.campaign_steps SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(stepConfig), stepId]
    );
  } catch (stepUpdateErr) {
    logger.error('[Lead Generation] Error storing offset in step config', { error: stepUpdateErr.message, stack: stepUpdateErr.stack, stepId });
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

