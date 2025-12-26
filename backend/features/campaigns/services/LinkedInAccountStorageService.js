/**
 * LinkedIn Account Storage Service
 * Handles database operations for LinkedIn account storage
 */

const { pool } = require('../../../shared/database/connection');

class LinkedInAccountStorageService {
  /**
   * Save LinkedIn account credentials to database
   */
  async saveLinkedInAccount(userId, credentials) {
    await pool.query(
      `INSERT INTO voice_agent.user_integrations_voiceagent
       (user_id, provider, credentials, is_connected, connected_at, created_at, updated_at)
       VALUES ($1, 'linkedin', $2::jsonb, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, provider) DO UPDATE
       SET credentials = $2::jsonb, is_connected = TRUE, connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(credentials)]
    );
  }
}

module.exports = new LinkedInAccountStorageService();

