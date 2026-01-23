const { getSchema } = require('../../../core/utils/schemaHelper');

/**
 * Repository for LinkedIn accounts data access
 */
class LinkedInAccountRepository {
  constructor(pool) {
    this.pool = pool;
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
