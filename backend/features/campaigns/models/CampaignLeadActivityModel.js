/**
 * Campaign Lead Activity Model
 * Data shapes, validation schemas, mapping helpers, and constants only
 * NO database calls - use CampaignLeadActivityRepository for SQL queries
 */

/**
 * Activity Status Enum
 */
const ACTIVITY_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  CONNECTED: 'connected',
  REPLIED: 'replied',
  OPENED: 'opened',
  CLICKED: 'clicked',
  FAILED: 'failed'
};

/**
 * Activity Action Type Enum
 */
const ACTION_TYPE = {
  EMAIL_SEND: 'email_send',
  LINKEDIN_MESSAGE: 'linkedin_message',
  LINKEDIN_CONNECTION: 'linkedin_connection',
  LINKEDIN_PROFILE_VISIT: 'linkedin_profile_visit',
  LINKEDIN_FOLLOW: 'linkedin_follow',
  WHATSAPP_SEND: 'whatsapp_send',
  INSTAGRAM_SEND: 'instagram_send',
  VOICE_CALL: 'voice_call',
  DELAY: 'delay'
};

/**
 * Campaign Lead Activity Data Shape
 * @typedef {Object} CampaignLeadActivityData
 * @property {string} tenantId - Tenant ID
 * @property {string} campaignId - Campaign ID
 * @property {string} campaignLeadId - Campaign lead ID
 * @property {string} stepId - Step ID
 * @property {string} stepType - Step type
 * @property {string} actionType - Action type
 * @property {string} [status] - Activity status (pending|sent|delivered|connected|replied|opened|clicked|failed)
 * @property {string} [channel] - Communication channel
 * @property {string} [messageContent] - Message content
 * @property {string} [subject] - Email subject
 * @property {string} [errorMessage] - Error message if failed
 * @property {Object} [metadata] - Additional metadata (JSONB)
 * @property {string} [provider] - Provider name
 * @property {string} [providerEventId] - Provider event ID
 * @property {Date} [executedAt] - Execution timestamp
 */

/**
 * Map database row to API format
 * @param {Object} dbRow - Database row
 * @returns {Object} Activity data for API
 */
function mapActivityFromDB(dbRow) {
  if (!dbRow) return null;
  
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    campaign_id: dbRow.campaign_id,
    campaign_lead_id: dbRow.campaign_lead_id,
    step_id: dbRow.step_id,
    step_type: dbRow.step_type,
    action_type: dbRow.action_type,
    status: dbRow.status,
    channel: dbRow.channel,
    subject: dbRow.subject,
    message_content: dbRow.message_content,
    error_message: dbRow.error_message,
    metadata: typeof dbRow.metadata === 'string' ? JSON.parse(dbRow.metadata) : (dbRow.metadata || {}),
    provider: dbRow.provider,
    provider_event_id: dbRow.provider_event_id,
    executed_at: dbRow.executed_at,
    is_deleted: dbRow.is_deleted,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at
  };
}

/**
 * Validate activity status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
function isValidActivityStatus(status) {
  return Object.values(ACTIVITY_STATUS).includes(status);
}

/**
 * Validate action type
 * @param {string} actionType - Action type to validate
 * @returns {boolean} True if valid
 */
function isValidActionType(actionType) {
  return Object.values(ACTION_TYPE).includes(actionType);
}

/**
 * Get allowed update fields
 * @returns {string[]} Array of allowed field names
 */
function getAllowedUpdateFields() {
  return ['status', 'error_message', 'metadata', 'message_content', 'subject', 'provider', 'provider_event_id', 'executed_at'];
}

/**
 * Check if status indicates success
 * @param {string} status - Activity status
 * @returns {boolean} True if status indicates success
 */
function isSuccessfulStatus(status) {
  return ['delivered', 'connected', 'replied'].includes(status);
}

module.exports = {
  ACTIVITY_STATUS,
  ACTION_TYPE,
  mapActivityFromDB,
  isValidActivityStatus,
  isValidActionType,
  getAllowedUpdateFields,
  isSuccessfulStatus
};
