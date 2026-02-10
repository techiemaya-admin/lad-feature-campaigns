const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

/**
 * Repository for LinkedIn accounts data access
 * LAD Architecture: Repository Layer (ONLY SQL)
 */
class LinkedInAccountRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get all active LinkedIn accounts for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Array>} List of accounts
   */
  async getAllAccountsForTenant(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided');
      return [];
    }

    const schema = getSchema(context);
    
    try {
      const query = `
        SELECT id, tenant_id, account_name, provider_account_id, status
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1 
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
        ORDER BY created_at DESC
      `;
      const result = await this.pool.query(query, [tenantId]);
      
      return result.rows.map(row => ({
        id: row.id,
        unipile_account_id: row.provider_account_id,
        account_name: row.account_name
      }));
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting accounts for tenant', {
        tenantId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get primary LinkedIn account for execution
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Account or null
   */
  async getPrimaryAccountForTenant(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided');
      return null;
    }

    const schema = getSchema(context);
    
    try {
      const query = `
        SELECT id, provider_account_id, account_name 
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1 
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const result = await this.pool.query(query, [tenantId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const account = result.rows[0];
      return {
        provider_account_id: account.provider_account_id,
        account_name: account.account_name || 'LinkedIn Account'
      };
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting primary account', {
        tenantId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if account exists and is active
   * @param {string} unipileAccountId - Provider account ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Account status
   */
  async checkAccountStatus(unipileAccountId, context = {}) {
    const schema = getSchema(context);
    
    try {
      const result = await this.pool.query(
        `SELECT id, status, updated_at 
         FROM ${schema}.social_linkedin_accounts 
         WHERE provider_account_id = $1 
         AND is_deleted = false
         LIMIT 1`,
        [unipileAccountId]
      );
      
      if (result.rows.length === 0) {
        return { exists: false };
      }

      const account = result.rows[0];
      return {
        exists: true,
        status: account.status,
        isActive: account.status === 'active',
        updatedAt: account.updated_at
      };
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error checking account status', {
        unipileAccountId,
        error: error.message
      });
      return { exists: false, error: error.message };
    }
  }

  /**
   * Get checkpoint metadata for LinkedIn account
   */
  async getCheckpointMetadata(req, { unipileAccountId, tenantId }) {
    const schema = getSchema(req);
    
    const result = await this.pool.query(
      `SELECT metadata
       FROM ${schema}.linkedin_accounts
       WHERE unipile_account_id = $1 AND tenant_id = $2 AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
      [unipileAccountId, tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const metadata = typeof result.rows[0].metadata === 'string'
      ? JSON.parse(result.rows[0].metadata)
      : (result.rows[0].metadata || {});

    return metadata;
  }
}

module.exports = LinkedInAccountRepository;

