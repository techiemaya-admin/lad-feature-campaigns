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
        SELECT id, tenant_id, account_name, provider_account_id, status, user_id, default_daily_limit
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
        account_name: row.account_name,
        user_id: row.user_id,
        default_daily_limit: row.default_daily_limit
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
        SELECT id, provider_account_id, account_name, user_id, default_daily_limit
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
        id: account.id,
        provider_account_id: account.provider_account_id,
        account_name: account.account_name || 'LinkedIn Account',
        user_id: account.user_id,
        default_daily_limit: account.default_daily_limit
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
           status,
           user_id
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
        status: row.status,
        user_id: row.user_id
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
          metadata,
          user_id
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
        metadata: row.metadata,
        user_id: row.user_id
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
          metadata,
          user_id
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
   * Check if an account already exists for the tenant matching by LinkedIn profile_url
   * @param {string} tenantId - Tenant ID
   * @param {string} profileUrl - LinkedIn profile URL (from metadata)
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Existing account limits or null
   */
  async checkAccountByProfileUrl(tenantId, profileUrl, context = {}) {
    if (!profileUrl) return null;
    const schema = getSchema(context);

    try {
      const result = await this.pool.query(
        `SELECT id, status, provider_account_id, default_daily_limit, default_weekly_limit 
         FROM ${schema}.social_linkedin_accounts
         WHERE tenant_id = $1 
         AND metadata->>'profile_url' = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId, profileUrl]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error checking existing account by profile_url', {
        error: error.message,
        tenantId,
        profileUrl
      });
      return null;
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
    const { userId, tenantId, unipileAccountId, accountName, metadata, dailyLimit, weeklyLimit } = accountData;

    try {
      const result = await this.pool.query(
        `INSERT INTO ${schema}.social_linkedin_accounts
          (user_id, tenant_id, provider_account_id, account_name, status, metadata, default_daily_limit, default_weekly_limit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, provider_account_id, account_name, status, default_daily_limit, default_weekly_limit`,
        [
          userId,
          tenantId,
          unipileAccountId,
          accountName,
          'active',
          JSON.stringify(metadata),
          dailyLimit !== undefined ? dailyLimit : 10,
          weeklyLimit !== undefined ? weeklyLimit : 70
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
    const { userId, tenantId, unipileAccountId, accountName, metadata, dailyLimit, weeklyLimit } = accountData;

    try {
      const result = await this.pool.query(
        `UPDATE ${schema}.social_linkedin_accounts
         SET 
           account_name = $4,
           status = 'active',
           metadata = $5::jsonb,
           default_daily_limit = COALESCE($6, default_daily_limit),
           default_weekly_limit = COALESCE($7, default_weekly_limit),
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND tenant_id = $2 AND provider_account_id = $3
         RETURNING id, provider_account_id, account_name, status, default_daily_limit, default_weekly_limit`,
        [
          userId,
          tenantId,
          unipileAccountId,
          accountName,
          JSON.stringify(metadata),
          dailyLimit,
          weeklyLimit
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

  /**
   * Get total daily limit for all active LinkedIn accounts of a tenant
   * Sums default_daily_limit from all active accounts
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<number>} Total daily limit
   */
  async getTotalDailyLimitForTenant(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided for getTotalDailyLimitForTenant');
      return 0;
    }

    const schema = getSchema(context);

    try {
      const query = `
        SELECT COALESCE(SUM(default_daily_limit), 0) as total_daily_limit
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1 
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
      `;

      const result = await this.pool.query(query, [tenantId]);
      const totalDailyLimit = parseInt(result.rows[0]?.total_daily_limit || 0);

      logger.debug('[LinkedInAccountRepository] Total daily limit retrieved', {
        tenantId,
        totalDailyLimit
      });

      return totalDailyLimit;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting total daily limit', {
        tenantId,
        error: error.message
      });
      // Return 0 on error to allow graceful degradation
      return 0;
    }
  }

  /**
   * Get today's connection request count for a tenant from campaign_analytics
   * Counts successful CONNECTION_SENT and CONNECTION_SENT_WITH_MESSAGE actions
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<number>} Count of connection requests sent today
   */
  async getTodayConnectionCount(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided for getTodayConnectionCount');
      return 0;
    }

    const schema = getSchema(context);

    try {
      // Get today's date range (midnight to midnight)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = tomorrow.toISOString();

      const query = `
        SELECT COUNT(*) as total_actions
        FROM ${schema}.campaign_analytics
        WHERE tenant_id = $1
        AND action_type IN ('CONNECTION_SENT', 'CONNECTION_SENT_WITH_MESSAGE')
        AND status = 'success'
        AND created_at >= $2
        AND created_at < $3
      `;

      const result = await this.pool.query(query, [tenantId, todayStart, tomorrowStart]);
      const todayConnectionCount = parseInt(result.rows[0]?.total_actions || 0);

      logger.debug('[LinkedInAccountRepository] Today connection count retrieved', {
        tenantId,
        todayConnectionCount,
        dateRange: { from: todayStart, to: tomorrowStart }
      });

      return todayConnectionCount;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting today connection count', {
        tenantId,
        error: error.message
      });
      // Return 0 on error to allow graceful degradation
      return 0;
    }
  }

  /**
   * Get today's connection request count for a specific account
   * @param {string} tenantId - Tenant ID
   * @param {string} providerAccountId - Provider Account ID
   * @param {Object} context - Request context
   * @returns {Promise<number>} Count of connection requests sent today
   */
  async getTodayConnectionCountForAccount(tenantId, providerAccountId, context = {}) {
    if (!tenantId || !providerAccountId) {
      return 0;
    }

    const schema = getSchema(context);

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = tomorrow.toISOString();

      const query = `
        SELECT COUNT(*) as total_actions
        FROM ${schema}.campaign_analytics
        WHERE tenant_id = $1
        AND provider_account_id = $2
        AND action_type IN ('CONNECTION_SENT', 'CONNECTION_SENT_WITH_MESSAGE')
        AND status = 'success'
        AND created_at >= $3
        AND created_at < $4
      `;

      const result = await this.pool.query(query, [tenantId, providerAccountId, todayStart, tomorrowStart]);
      return parseInt(result.rows[0]?.total_actions || 0);
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting today connection count for account', {
        tenantId,
        providerAccountId,
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Get total weekly limit for all active LinkedIn accounts of a tenant
   * Sums default_weekly_limit from all active accounts
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<number>} Total weekly limit
   */
  async getTotalWeeklyLimitForTenant(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided for getTotalWeeklyLimitForTenant');
      return 0;
    }

    const schema = getSchema(context);

    try {
      const query = `
        SELECT COALESCE(SUM(default_weekly_limit), 0) as total_weekly_limit
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1 
        AND status = 'active'
        AND is_deleted = false
        AND provider_account_id IS NOT NULL
        AND default_weekly_limit IS NOT NULL
      `;

      const result = await this.pool.query(query, [tenantId]);
      const totalWeeklyLimit = parseInt(result.rows[0]?.total_weekly_limit || 0);

      logger.debug('[LinkedInAccountRepository] Total weekly limit retrieved', {
        tenantId,
        totalWeeklyLimit
      });

      return totalWeeklyLimit;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting total weekly limit', {
        tenantId,
        error: error.message
      });
      // Return 0 on error to allow graceful degradation
      return 0;
    }
  }

  /**
   * Get last 7 days connection request count for a tenant (rolling window)
   * Counts successful CONNECTION_SENT and CONNECTION_SENT_WITH_MESSAGE actions from last 7 days
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<number>} Count of connection requests sent in last 7 days
   */
  async getLastSevenDaysConnectionCount(tenantId, context = {}) {
    if (!tenantId) {
      logger.warn('[LinkedInAccountRepository] No tenantId provided for getLastSevenDaysConnectionCount');
      return 0;
    }

    const schema = getSchema(context);

    try {
      // Get last 7 days date range (7 days ago to now)
      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const sevenDaysAgoStart = sevenDaysAgo.toISOString();
      const nowEnd = now.toISOString();

      const query = `
        SELECT COUNT(*) as total_actions
        FROM ${schema}.campaign_analytics
        WHERE tenant_id = $1
        AND action_type IN ('CONNECTION_SENT', 'CONNECTION_SENT_WITH_MESSAGE')
        AND status = 'success'
        AND created_at >= $2
        AND created_at <= $3
      `;

      const result = await this.pool.query(query, [tenantId, sevenDaysAgoStart, nowEnd]);
      const lastSevenDaysCount = parseInt(result.rows[0]?.total_actions || 0);

      logger.debug('[LinkedInAccountRepository] Last 7 days connection count retrieved', {
        tenantId,
        lastSevenDaysCount,
        dateRange: { from: sevenDaysAgoStart, to: nowEnd }
      });

      return lastSevenDaysCount;
    } catch (error) {
      logger.error('[LinkedInAccountRepository] Error getting last 7 days connection count', {
        tenantId,
        error: error.message
      });
      // Return 0 on error to allow graceful degradation
      return 0;
    }
  }
}

module.exports = LinkedInAccountRepository;

