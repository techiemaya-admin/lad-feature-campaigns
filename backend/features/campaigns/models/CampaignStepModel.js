/**
 * Campaign Step Model
 * Data shapes, validation schemas, mapping helpers, and constants only
 * NO database calls - use CampaignStepRepository for SQL queries
 */

/**
 * Step Type Enum
 */
const STEP_TYPE = {
  LEAD_GENERATION: 'lead_generation',
  EMAIL: 'email',
  LINKEDIN_MESSAGE: 'linkedin_message',
  LINKEDIN_CONNECTION: 'linkedin_connection',
  LINKEDIN_PROFILE_VISIT: 'linkedin_profile_visit',
  LINKEDIN_FOLLOW: 'linkedin_follow',
  WHATSAPP: 'whatsapp',
  INSTAGRAM: 'instagram',
  VOICE_AGENT: 'voice_agent',
  DELAY: 'delay',
  CONDITION: 'condition'
};

/**
 * Campaign Step Data Shape
 * @typedef {Object} CampaignStepData
 * @property {string} campaignId - Campaign ID
 * @property {string} type - Step type
 * @property {number} order - Step order in workflow
 * @property {string} title - Step title
 * @property {string} [description] - Step description
 * @property {Object} [config] - Step configuration (JSONB)
 */

/**
 * Field mapping from API to database columns
 */
const FIELD_MAPPING = {
  'type': 'step_type',
  'order': 'step_order',
  'title': 'title',
  'description': 'description',
  'config': 'config'
};

/**
 * Map step data from database to API format
 * @param {Object} dbRow - Database row
 * @returns {Object} Step data for API
 */
function mapStepFromDB(dbRow) {
  if (!dbRow) return null;
  
  return {
    id: dbRow.id,
    tenant_id: dbRow.tenant_id,
    campaign_id: dbRow.campaign_id,
    type: dbRow.type || dbRow.step_type,
    order: dbRow.order !== undefined ? dbRow.order : dbRow.step_order,
    title: dbRow.title,
    description: dbRow.description,
    config: typeof dbRow.config === 'string' ? JSON.parse(dbRow.config) : (dbRow.config || {}),
    is_deleted: dbRow.is_deleted,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at
  };
}

/**
 * Map step data to database format
 * @param {Object} stepData - Step data from API
 * @returns {Object} Mapped step data for database
 */
function mapStepDataToDB(stepData) {
  return {
    campaignId: stepData.campaignId,
    type: stepData.type,
    order: stepData.order,
    title: stepData.title,
    description: stepData.description || '',
    config: stepData.config || {}
  };
}

/**
 * Validate step type
 * @param {string} type - Type to validate
 * @returns {boolean} True if valid
 */
function isValidStepType(type) {
  return Object.values(STEP_TYPE).includes(type);
}

/**
 * Get allowed update fields
 * @returns {string[]} Array of allowed field names
 */
function getAllowedUpdateFields() {
  return ['type', 'order', 'title', 'description', 'config'];
}

/**
 * Get database column name for field
 * @param {string} fieldName - API field name
 * @returns {string} Database column name
 */
function getDBColumnName(fieldName) {
  return FIELD_MAPPING[fieldName] || fieldName;
}

module.exports = {
  STEP_TYPE,
  FIELD_MAPPING,
  mapStepFromDB,
  mapStepDataToDB,
  isValidStepType,
  getAllowedUpdateFields,
  getDBColumnName
};
