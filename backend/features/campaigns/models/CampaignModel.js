/**
 * Campaign Model
 * Data shapes, validation schemas, mapping helpers, and constants only
 * NO database calls - use CampaignRepository for SQL queries
 */

/**
 * Campaign Status Enum
 */
const CAMPAIGN_STATUS = {
  DRAFT: 'draft',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COMPLETED: 'completed'
};

/**
 * Campaign Data Shape
 * @typedef {Object} CampaignData
 * @property {string} name - Campaign name
 * @property {string} status - Campaign status (draft|running|paused|stopped|completed)
 * @property {string} createdBy - User ID who created the campaign
 * @property {Object} config - Campaign configuration (JSONB)
 * @property {string} [execution_state] - Current execution state
 * @property {Date} [last_lead_check_at] - Last time leads were checked
 * @property {Date} [next_run_at] - Next scheduled run time
 * @property {string} [last_execution_reason] - Reason for last execution
 */

/**
 * Campaign Update Shape
 * @typedef {Object} CampaignUpdate
 * @property {string} [name] - Campaign name
 * @property {string} [status] - Campaign status
 * @property {Object} [config] - Campaign configuration
 * @property {string} [execution_state] - Execution state
 * @property {Date} [last_lead_check_at] - Last lead check timestamp
 * @property {Date} [next_run_at] - Next run timestamp
 * @property {string} [last_execution_reason] - Last execution reason
 */

/**
 * Map campaign data to database format
 * @param {Object} campaignData - Campaign data from API
 * @returns {Object} Mapped campaign data for database
 */
function mapCampaignDataToDB(campaignData) {
  return {
    name: campaignData.name,
    status: campaignData.status || CAMPAIGN_STATUS.DRAFT,
    createdBy: campaignData.createdBy,
    config: campaignData.config || {}
  };
}

/**
 * Map database row to API format
 * @param {Object} dbRow - Database row
 * @returns {Object} Campaign data for API
 */
function mapCampaignFromDB(dbRow) {
  if (!dbRow) return null;
  
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    name: dbRow.name,
    status: dbRow.status,
    created_by_user_id: dbRow.created_by_user_id || dbRow.created_by,
    config: typeof dbRow.config === 'string' ? JSON.parse(dbRow.config) : (dbRow.config || {}),
    execution_state: dbRow.execution_state,
    last_lead_check_at: dbRow.last_lead_check_at,
    next_run_at: dbRow.next_run_at,
    last_execution_reason: dbRow.last_execution_reason,
    is_deleted: dbRow.is_deleted,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at,
    // Aggregated fields from joins
    leads_count: dbRow.leads_count || 0,
    sent_count: dbRow.sent_count || 0,
    delivered_count: dbRow.delivered_count || 0,
    connected_count: dbRow.connected_count || 0,
    replied_count: dbRow.replied_count || 0,
    opened_count: dbRow.opened_count || 0,
    clicked_count: dbRow.clicked_count || 0
  };
}

/**
 * Validate campaign status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
function isValidStatus(status) {
  return Object.values(CAMPAIGN_STATUS).includes(status);
}

/**
 * Get allowed update fields
 * @returns {string[]} Array of allowed field names
 */
function getAllowedUpdateFields() {
  return ['name', 'status', 'config', 'execution_state', 'last_lead_check_at', 'next_run_at', 'last_execution_reason'];
}

module.exports = {
  CAMPAIGN_STATUS,
  mapCampaignDataToDB,
  mapCampaignFromDB,
  isValidStatus,
  getAllowedUpdateFields
};
