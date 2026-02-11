/**
 * LinkedIn Account Query Service
 * Handles database queries for LinkedIn accounts
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
/**
 * Get all connected LinkedIn accounts for a user/tenant  
 * Uses social_linkedin_accounts table (production schema)
 * @param {string} tenantId - Tenant ID (required for multi-tenancy)
 * @param {Object} req - Optional request context for schema resolution
 */
async function getUserLinkedInAccounts(tenantId, req = null) {
  try {
    const schema = getSchema(req);
    
    // Query social_linkedin_accounts table (production schema)
    const query = `
      SELECT 
        id, 
        tenant_id,
        account_name,
        provider_account_id as unipile_account_id,
        status,
        created_at,
        metadata
      FROM ${schema}.social_linkedin_accounts
      WHERE tenant_id = $1 
      AND status = 'active'
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [tenantId]);
    
    if (!result || result.rows.length === 0) {
      return [];
    }
    
    // Map results to consistent format
    return result.rows.map(row => ({
      id: row.id,
      connectionId: row.id,
      unipileAccountId: row.unipile_account_id,
      account_name: row.account_name,
      provider_account_id: row.unipile_account_id,
      accountName: row.account_name || 'LinkedIn Account',
      profileUrl: row.metadata?.profile_url || null,
      email: row.metadata?.email || null,
      isActive: row.status === 'active',
      status: row.status,
      connectedAt: row.created_at,
      metadata: row.metadata
    }));
  } catch (error) {
    const logger = require('../../../core/utils/logger');
    logger.error('[LinkedInAccountQueryService] Error getting LinkedIn accounts', {
      error: error.message,
      tenantId
    });
    return [];
  }
}
/**
 * Find LinkedIn account by unipile_account_id (provider_account_id)
 * Uses social_linkedin_accounts table (production schema)
 */
async function findAccountByUnipileId(tenantId, unipileAccountId) {
  try {
    const schema = getSchema();
    
    const result = await pool.query(
      `SELECT 
        id, 
        provider_account_id as unipile_account_id, 
        account_name,
        status,
        metadata
       FROM ${schema}.social_linkedin_accounts
       WHERE tenant_id = $1 
       AND provider_account_id = $2
       LIMIT 1`,
      [tenantId, unipileAccountId]
    );
    
    if (result.rows.length > 0) {
      return { 
        account: result.rows[0], 
        schema: 'social_linkedin_accounts' 
      };
    }
    
    return null;
  } catch (error) {
    const logger = require('../../../core/utils/logger');
    logger.error('[LinkedInAccountQueryService] Error finding account by unipile ID', {
      error: error.message,
      tenantId,
      unipileAccountId
    });
    return null;
  }
}
module.exports = {
  getUserLinkedInAccounts,
  findAccountByUnipileId
};
