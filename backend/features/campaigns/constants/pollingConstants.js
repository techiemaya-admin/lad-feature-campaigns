/**
 * LinkedIn Polling Constants
 * Defines schedules, statuses, and enums for LinkedIn connection polling
 * 
 * LAD Architecture: Constants Layer
 */

module.exports = {
  /**
   * Polling schedule - 3 times per working day (GST timezone)
   * Cron format: minute hour day month weekday
   */
  POLLING_SCHEDULE: {
    MORNING: '0 11 * * 1-5',   // 11:00 AM GST, Mon-Fri
    AFTERNOON: '0 14 * * 1-5', // 2:00 PM GST, Mon-Fri
    EVENING: '0 17 * * 1-5'    // 5:00 PM GST, Mon-Fri
  },

  /**
   * LinkedIn invitation statuses from Unipile API
   */
  INVITATION_STATUS: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    WITHDRAWN: 'withdrawn'
  },

  /**
   * Campaign analytics action types
   */
  ACTION_TYPES: {
    CONNECTION_SENT: 'CONNECTION_SENT',
    CONNECTION_SENT_WITH_MESSAGE: 'CONNECTION_SENT_WITH_MESSAGE',
    CONNECTION_ACCEPTED: 'CONNECTION_ACCEPTED',
    CONNECTION_DECLINED: 'CONNECTION_DECLINED',
    MESSAGE_SKIPPED: 'MESSAGE_SKIPPED',
    CONTACTED: 'CONTACTED'
  },

  /**
   * Processing status
   */
  PROCESSING_STATUS: {
    SUCCESS: 'success',
    FAILED: 'failed',
    SKIPPED: 'skipped'
  },

  /**
   * LinkedIn URL patterns for normalization
   */
  LINKEDIN_URL_PATTERNS: {
    BASE_URL: 'https://www.linkedin.com/in/',
    REGEX: /linkedin\.com\/in\/([^\/\?#]+)/i
  },

  /**
   * Polling limits and timeouts
   */
  LIMITS: {
    MAX_RELATIONS_PER_ACCOUNT: 1000,
    API_TIMEOUT_MS: 30000,
    BATCH_SIZE: 100
  }
};
