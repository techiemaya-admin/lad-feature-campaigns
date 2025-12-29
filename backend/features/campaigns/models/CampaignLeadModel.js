/**
 * Campaign Lead Model
 * Data shapes, validation schemas, mapping helpers, and constants only
 * NO database calls - use CampaignLeadRepository for SQL queries
 */

/**
 * Lead Status Enum
 */
const LEAD_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused'
};

/**
 * Campaign Lead Data Shape
 * @typedef {Object} CampaignLeadData
 * @property {string} campaignId - Campaign ID
 * @property {string} [leadId] - External lead ID (UUID)
 * @property {string} firstName - First name
 * @property {string} lastName - Last name
 * @property {string} [email] - Email address
 * @property {string} [linkedinUrl] - LinkedIn profile URL
 * @property {string} [companyName] - Company name
 * @property {string} [title] - Job title
 * @property {string} [phone] - Phone number
 * @property {Object} [leadData] - Custom lead data (JSONB)
 * @property {string} [status] - Lead status (active|completed|failed|paused)
 */

/**
 * Snapshot Shape (stored in JSONB)
 * @typedef {Object} LeadSnapshot
 * @property {string} first_name
 * @property {string} last_name
 * @property {string} email
 * @property {string} linkedin_url
 * @property {string} company_name
 * @property {string} title
 * @property {string} phone
 */

/**
 * Map lead data to snapshot format
 * @param {Object} leadData - Lead data from API
 * @returns {Object} Snapshot object for database
 */
function mapLeadToSnapshot(leadData) {
  return {
    first_name: leadData.firstName,
    last_name: leadData.lastName,
    email: leadData.email,
    linkedin_url: leadData.linkedinUrl,
    company_name: leadData.companyName,
    title: leadData.title,
    phone: leadData.phone
  };
}

/**
 * Map snapshot from database to lead data
 * @param {Object} snapshot - Snapshot from database
 * @returns {Object} Lead data for API
 */
function mapSnapshotToLead(snapshot) {
  if (!snapshot) return null;
  
  const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  return {
    firstName: parsed.first_name,
    lastName: parsed.last_name,
    email: parsed.email,
    linkedinUrl: parsed.linkedin_url,
    companyName: parsed.company_name,
    title: parsed.title,
    phone: parsed.phone
  };
}

/**
 * Map database row to API format
 * @param {Object} dbRow - Database row
 * @returns {Object} Lead data for API
 */
function mapLeadFromDB(dbRow) {
  if (!dbRow) return null;
  
  const snapshot = mapSnapshotToLead(dbRow.snapshot);
  const leadData = typeof dbRow.lead_data === 'string' ? JSON.parse(dbRow.lead_data) : (dbRow.lead_data || {});
  
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    campaign_id: dbRow.campaign_id,
    lead_id: dbRow.lead_id,
    ...snapshot,
    leadData: leadData,
    snapshot: dbRow.snapshot,
    status: dbRow.status,
    current_step_order: dbRow.current_step_order,
    started_at: dbRow.started_at,
    completed_at: dbRow.completed_at,
    error_message: dbRow.error_message,
    is_deleted: dbRow.is_deleted,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at
  };
}

/**
 * Validate lead status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
function isValidLeadStatus(status) {
  return Object.values(LEAD_STATUS).includes(status);
}

/**
 * Get allowed update fields
 * @returns {string[]} Array of allowed field names
 */
function getAllowedUpdateFields() {
  return ['snapshot', 'lead_data', 'status', 'current_step_order', 'started_at', 'completed_at', 'error_message'];
}

module.exports = {
  LEAD_STATUS,
  mapLeadToSnapshot,
  mapSnapshotToLead,
  mapLeadFromDB,
  isValidLeadStatus,
  getAllowedUpdateFields
};
