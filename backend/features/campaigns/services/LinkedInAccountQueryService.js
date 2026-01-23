/**
 * LinkedIn Account Query Service
 * Handles database queries for LinkedIn accounts
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
/**
 * Get all connected LinkedIn accounts for a user/tenant
 * Uses TDD schema (${schema}.linkedin_accounts) with fallback to old schema
 */
async function getUserLinkedInAccounts(userId) {
  try {
    const schema = getSchema(req);
    // Use ${schema}.linkedin_accounts table per TDD
    // First try the TDD schema, fallback to old schema if needed
    let query = `
      SELECT 
        id, 
        tenant_id,
        account_name,
        unipile_account_id,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM ${schema}.linkedin_accounts
      WHERE tenant_id = $1 
      AND is_active = TRUE
      ORDER BY created_at DESC
    `;
    // Get tenant_id from user_id (userId might be user_id, need to get tenant_id)
    // First try using userId as tenant_id (in dev they might be the same)
    let result;
    let useTddSchema = true;
    try {
      result = await pool.query(query, [userId]);
    } catch (tddError) {
      // Fallback to old schema if TDD table doesn't exist
      useTddSchema = false;
      query = `
        SELECT id, credentials, is_connected, connected_at
        FROM ${schema}.user_integrations_voiceagent
        WHERE (user_id::text = $1 OR user_id = $1::integer)
        AND provider = 'linkedin'
        AND is_connected = TRUE
        ORDER BY connected_at DESC NULLS LAST, created_at DESC
      `;
      try {
        result = await pool.query(query, [userId]);
      } catch (fallbackError) {
        return [];
      }
    }
    if (!result || result.rows.length === 0) {
      return [];
    }
    // Map results to consistent format
    if (useTddSchema) {
      return result.rows.map(row => ({
        id: row.id, // Database UUID
        connectionId: row.id, // For frontend compatibility
        unipileAccountId: row.unipile_account_id,
        accountName: row.account_name || 'LinkedIn Account',
        profileUrl: row.metadata?.profile_url || row.metadata?.linkedin_url || null,
        email: row.metadata?.email || null,
        isActive: row.is_active,
        connectedAt: row.created_at,
        metadata: row.metadata
      }));
    } else {
      // Old schema mapping
      return result.rows.map(row => {
        const credentials = typeof row.credentials === 'string' 
          ? JSON.parse(row.credentials) 
          : row.credentials || {};
        return {
          id: row.id, // Database ID
          connectionId: row.id, // For frontend compatibility
          unipileAccountId: credentials.unipile_account_id || credentials.account_id || credentials.unipileAccountId,
          accountName: credentials.account_name || credentials.profile_name || 'LinkedIn Account',
          profileUrl: credentials.profile_url || credentials.linkedin_url || null,
          email: credentials.email || null,
          isActive: row.is_connected,
          connectedAt: row.connected_at,
          metadata: credentials
        };
      });
    }
  } catch (error) {
    return [];
  }
}
/**
 * Find LinkedIn account by unipile_account_id
 */
async function findAccountByUnipileId(tenantId, unipileAccountId) {
  try {
    // Try TDD schema first
    const schema = getSchema();
    try {
      const result = await pool.query(
        `SELECT id, unipile_account_id, is_active
         FROM ${schema}.linkedin_accounts
         WHERE tenant_id = $1 
         AND unipile_account_id = $2
         LIMIT 1`,
        [tenantId, unipileAccountId]
      );
      if (result.rows.length > 0) {
        return { account: result.rows[0], schema: 'tdd' };
      }
    } catch (tddError) {
      // Fall through to old schema
    }
    // Fallback to old schema
    const result = await pool.query(
      `SELECT id, credentials
       FROM ${schema}.user_integrations_voiceagent
       WHERE user_id::text = $1 
       AND provider = 'linkedin'
       AND (credentials->>'unipile_account_id' = $2 OR credentials->>'account_id' = $2)
       LIMIT 1`,
      [tenantId, unipileAccountId]
    );
    if (result.rows.length > 0) {
      return { account: result.rows[0], schema: 'old' };
    }
    return null;
  } catch (error) {
    return null;
  }
}
module.exports = {
  getUserLinkedInAccounts,
  findAccountByUnipileId
};
