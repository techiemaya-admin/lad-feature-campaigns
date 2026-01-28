/**
 * LinkedIn Account Storage Service
 * Handles database operations for LinkedIn account storage
 * Uses TDD schema: ${schema}.linkedin_accounts with tenant_id (UUID)
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
class LinkedInAccountStorageService {
  /**
   * Save LinkedIn account credentials to database
   * Uses TDD schema: ${schema}.linkedin_accounts
   * @param {string} tenantId - Tenant ID (UUID)
   * @param {Object} credentials - Account credentials with unipile_account_id, profile_name, etc.
   */
  async saveLinkedInAccount(tenantId, credentials) {
    const unipileAccountId = credentials.unipile_account_id;
    if (!unipileAccountId) {
      throw new Error('unipile_account_id is required');
    }
    const schema = getSchema(req);
    // Use TDD schema: ${schema}.linkedin_accounts
    // First try TDD schema, fallback to old schema if needed
    try {
      const query = `
        INSERT INTO ${schema}.linkedin_accounts
          (tenant_id, unipile_account_id, account_name, is_active, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, unipile_account_id) DO UPDATE
        SET 
          account_name = EXCLUDED.account_name,
          is_active = TRUE,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      `;
      const metadata = {
        profile_name: credentials.profile_name || null,
        profile_url: credentials.profile_url || null,
        email: credentials.email || null,
        connected_at: credentials.connected_at || new Date().toISOString(),
        ...credentials // Include any other fields
      };
      await pool.query(query, [
        tenantId,
        unipileAccountId,
        credentials.profile_name || 'LinkedIn User',
        true, // is_active
        JSON.stringify(metadata)
      ]);
    } catch (tddError) {
      // Fallback to old schema if TDD table doesn't exist
      // Try old schema with user_id as text (in case it's actually text, not integer)
      try {
        await pool.query(
          `INSERT INTO ${schema}.user_integrations_voiceagent
           (user_id, provider, credentials, is_connected, connected_at, created_at, updated_at)
           VALUES ($1::text, 'linkedin', $2::jsonb, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, provider) DO UPDATE
           SET credentials = $2::jsonb, is_connected = TRUE, connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
          [tenantId, JSON.stringify(credentials)]
        );
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
  }
}
module.exports = new LinkedInAccountStorageService();
