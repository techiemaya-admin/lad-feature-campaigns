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

  /**
   * Update account status (for webhook updates)
   * LAD Architecture: Repository layer - SQL only
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} status - Account status (active, credentials_expired, error, etc.)
   * @param {boolean} needsReconnect - Whether account needs reconnection
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} Success status
   */
  async updateAccountStatus(unipileAccountId, status, needsReconnect, context = {}) {
    const schema = getSchema(context);
    
    try {
      // Update social_linkedin_accounts table (TDD)
      await this.pool.query(
        `UPDATE ${schema}.social_linkedin_accounts 
         SET 
           status = $1,
           updated_at = NOW()
         WHERE provider_account_id = $2`,
        [status, unipileAccountId]
      );

      // Also update linkedin_accounts table if it exists
      try {
        await this.pool.query(
          `UPDATE ${schema}.linkedin_accounts 
           SET 
             account_status = $1,
             needs_reconnect = $2,
             last_status_check = NOW(),
             updated_at = NOW()
           WHERE unipile_account_id = $3`,
          [status, needsReconnect, unipileAccountId]
        );
      } catch (error) {
        // Table might not exist or columns might not exist - not critical
        logger.debug('[LinkedInAccountRepository] linkedin_accounts table update skipped', {
          error: error.message
        });
      }

      logger.info('[LinkedInAccountRepository] Account status updated', {
        unipileAccountId,
        status,
        needsReconnect
      });

      return true;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Failed to update account status', {
        unipileAccountId,
        status,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get account by Unipile account ID (for webhook processing)
   * LAD Architecture: Repository layer - SQL only
   * @param {string} unipileAccountId - Unipile account ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Account data or null
   */
  async getAccountByUnipileId(unipileAccountId, context = {}) {
    const schema = getSchema(context);
    
    try {
      const result = await this.pool.query(
        `SELECT 
           id,
           tenant_id,
           account_name,
           provider_account_id,
           status
         FROM ${schema}.social_linkedin_accounts
         WHERE provider_account_id = $1
         AND is_deleted = false
         LIMIT 1`,
        [unipileAccountId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        unipile_account_id: row.provider_account_id,
        account_name: row.account_name,
        status: row.status
      };
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Failed to get account by Unipile ID', {
        unipileAccountId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get all connected LinkedIn accounts for a tenant
   * LAD Architecture: Repository layer - SQL only
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Array>} List of accounts with full details
   */
  async getUserLinkedInAccounts(tenantId, context = {}) {
    const schema = getSchema(context);
    
    try {
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
      
      const result = await this.pool.query(query, [tenantId]);
      
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
      logger.error('[LinkedInAccountRepository] Error getting LinkedIn accounts', {
        error: error.message,
        tenantId
      });
      return [];
    }
  }

  /**
   * Find LinkedIn account by tenant and Unipile ID
   * LAD Architecture: Repository layer - SQL only
   * @param {string} tenantId - Tenant ID
   * @param {string} unipileAccountId - Unipile account ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Account data or null
   */
  async findAccountByTenantAndUnipileId(tenantId, unipileAccountId, context = {}) {
    const schema = getSchema(context);
    
    try {
      const result = await this.pool.query(
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
      logger.error('[LinkedInAccountRepository] Error finding account by tenant and unipile ID', {
        error: error.message,
        tenantId,
        unipileAccountId
      });
      return null;
    }
  }

  /**
   * Check if account exists for user and tenant
   * LAD Architecture: Repository layer - SQL only
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @param {string} unipileAccountId - Unipile account ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Existing account or null
   */
  async checkExistingAccount(userId, tenantId, unipileAccountId, context = {}) {
    const schema = getSchema(context);
    
    try {
      const result = await this.pool.query(
        `SELECT id, status FROM ${schema}.social_linkedin_accounts
         WHERE user_id = $1 AND tenant_id = $2 AND provider_account_id = $3
         LIMIT 1`,
        [userId, tenantId, unipileAccountId]
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error checking existing account', {
        error: error.message,
        userId,
        tenantId,
        unipileAccountId
      });
      throw error;
    }
  }

  /**
   * Insert new LinkedIn account
   * LAD Architecture: Repository layer - SQL only
   * @param {Object} accountData - Account data
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Created account
   */
  async insertAccount(accountData, context = {}) {
    const schema = getSchema(context);
    const { userId, tenantId, unipileAccountId, accountName, metadata } = accountData;
    
    try {
      const result = await this.pool.query(
        `INSERT INTO ${schema}.social_linkedin_accounts
          (user_id, tenant_id, provider_account_id, account_name, status, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, provider_account_id, account_name, status`,
        [
          userId,
          tenantId,
          unipileAccountId,
          accountName,
          'active',
          JSON.stringify(metadata)
        ]
      );
      
      return result.rows[0];
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error inserting account', {
        error: error.message,
        userId,
        tenantId,
        unipileAccountId
      });
      throw error;
    }
  }

  /**
   * Update existing LinkedIn account
   * LAD Architecture: Repository layer - SQL only
   * @param {Object} accountData - Account data
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Updated account
   */
  async updateAccount(accountData, context = {}) {
    const schema = getSchema(context);
    const { userId, tenantId, unipileAccountId, accountName, metadata } = accountData;
    
    try {
      const result = await this.pool.query(
        `UPDATE ${schema}.social_linkedin_accounts
         SET 
           account_name = $4,
           status = 'active',
           metadata = $5::jsonb,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND tenant_id = $2 AND provider_account_id = $3
         RETURNING id, provider_account_id, account_name, status`,
        [
          userId,
          tenantId,
          unipileAccountId,
          accountName,
          JSON.stringify(metadata)
        ]
      );
      
      return result.rows[0];
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error updating account', {
        error: error.message,
        userId,
        tenantId,
        unipileAccountId
      });
      throw error;
    }
  }
}

module.exports = LinkedInAccountRepository;

