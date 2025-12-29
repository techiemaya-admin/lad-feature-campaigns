/**
 * Constants for Campaigns Feature
 * Centralized location for feature-level constants and configuration
 * 
 * NOTE: Model-specific constants (CAMPAIGN_STATUS, LEAD_STATUS, STEP_TYPE, ACTIVITY_STATUS, ACTION_TYPE)
 * are now defined in their respective model files. Import them from:
 * - CampaignModel.CAMPAIGN_STATUS
 * - CampaignLeadModel.LEAD_STATUS
 * - CampaignStepModel.STEP_TYPE
 * - CampaignLeadActivityModel.ACTIVITY_STATUS
 * - CampaignLeadActivityModel.ACTION_TYPE
 */

// Campaign Types
const CAMPAIGN_TYPE = {
  EMAIL: 'email',
  SMS: 'sms',
  VOICE: 'voice',
  LINKEDIN: 'linkedin',
  MULTI_CHANNEL: 'multi-channel'
};

// Campaign Step Status
const STEP_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

// Activity Types
const ACTIVITY_TYPE = {
  STEP_STARTED: 'step_started',
  STEP_COMPLETED: 'step_completed',
  STEP_FAILED: 'step_failed',
  EMAIL_SENT: 'email_sent',
  SMS_SENT: 'sms_sent',
  CONNECTION_SENT: 'connection_sent',
  MESSAGE_SENT: 'message_sent',
  RESPONSE_RECEIVED: 'response_received'
};

// LinkedIn Checkpoint Types
const CHECKPOINT_TYPE = {
  IN_APP_VALIDATION: 'IN_APP_VALIDATION',
  EMAIL_PIN_VERIFICATION: 'EMAIL_PIN_VERIFICATION',
  SMS_PIN_VERIFICATION: 'SMS_PIN_VERIFICATION',
  CAPTCHA: 'CAPTCHA'
};

// LinkedIn Account Status
const LINKEDIN_ACCOUNT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  EXPIRED: 'expired',
  ERROR: 'error'
};

// Error Codes
const ERROR_CODE = {
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  STEP_NOT_FOUND: 'STEP_NOT_FOUND',
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  LINKEDIN_AUTH_FAILED: 'LINKEDIN_AUTH_FAILED',
  LINKEDIN_CHECKPOINT: 'LINKEDIN_CHECKPOINT',
  DATABASE_ERROR: 'DATABASE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

// Channel Types
const CHANNEL = {
  EMAIL: 'email',
  SMS: 'sms',
  VOICE: 'voice',
  LINKEDIN: 'linkedin'
};

// Execution Status
const EXECUTION_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING: 'pending',
  RETRY: 'retry'
};

// Default Values
const DEFAULTS = {
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  RETRY_ATTEMPTS: 3,
  TIMEOUT_MS: 30000
};

// API Configuration
const API_CONFIG = {
  // Unipile API base URL (can be overridden via UNIPILE_DSN or UNIPILE_API_BASE_URL)
  UNIPILE_DEFAULT_BASE_URL: 'https://api.unipile.com/api/v1',
  // Unipile lookup timeout (ms)
  UNIPILE_LOOKUP_TIMEOUT_MS: 15000
};

module.exports = {
  // Feature-level constants (not model-specific)
  CAMPAIGN_TYPE,
  STEP_STATUS,
  ACTIVITY_TYPE,
  CHECKPOINT_TYPE,
  LINKEDIN_ACCOUNT_STATUS,
  ERROR_CODE,
  CHANNEL,
  EXECUTION_STATUS,
  DEFAULTS,
  API_CONFIG
};
