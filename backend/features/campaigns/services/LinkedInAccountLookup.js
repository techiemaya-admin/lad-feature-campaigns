/**
 * LinkedIn Account Lookup Service
 * Handles LinkedIn account retrieval strategies
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

/**
 * Get all available LinkedIn accounts for a tenant/user (for account fallback)
 */
async function getAllLinkedInAccountsForTenant(tenantId, userId) {
  const accounts = [];
  
  try {
    const resolvedTenantId = tenantId || userId;
    const schema = resolvedTenantId ? getSchema({ user: { tenant_id: resolvedTenantId } }) : getSchema(null);
    
    try {
      const query = `
        SELECT id, tenant_id, account_name, unipile_account_id, is_active
        FROM ${schema}.linkedin_accounts
        WHERE tenant_id = $1 
        AND is_active = TRUE
        AND unipile_account_id IS NOT NULL
        ORDER BY created_at DESC
      `;
      
      const result = await pool.query(query, [tenantId]);
      if (result.rows.length > 0) {
        accounts.push(...result.rows.map(row => ({
          id: row.id,
          unipile_account_id: row.unipile_account_id,
          account_name: row.account_name
        })));
      }
    } catch (tddError) {
      // TDD schema not available, continue to fallback
    }
    
    if (accounts.length === 0 && userId) {
      try {
        const fallbackQuery = await pool.query(
          `SELECT id::text as id, 
                  COALESCE(
                    NULLIF(credentials->>'unipile_account_id', ''),
                    NULLIF(credentials->>'account_id', ''),
                    NULLIF(credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent 
           WHERE provider = 'linkedin'
           AND (user_id::text = $1 OR user_id = $1::integer)
           AND is_connected = TRUE
           AND (
             (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
             OR
             (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
             OR
             (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY connected_at DESC NULLS LAST, created_at DESC`,
          [userId]
        );
        
        if (fallbackQuery.rows.length > 0) {
          accounts.push(...fallbackQuery.rows.map(row => ({
            id: row.id,
            unipile_account_id: row.unipile_account_id,
            account_name: 'LinkedIn Account'
          })));
        }
      } catch (fallbackError) {
        // Ignore fallback errors
      }
    }
    
    if (accounts.length === 0) {
      try {
        const globalQuery = await pool.query(
          `SELECT id, unipile_account_id, account_name
           FROM ${schema}.linkedin_accounts
           WHERE is_active = TRUE
           AND unipile_account_id IS NOT NULL
           ORDER BY created_at DESC`
        );
        
        if (globalQuery.rows.length > 0) {
          accounts.push(...globalQuery.rows.map(row => ({
            id: row.id,
            unipile_account_id: row.unipile_account_id,
            account_name: row.account_name || 'LinkedIn Account'
          })));
        }
      } catch (globalError) {
        // Ignore global search errors
      }
    }
  } catch (error) {
    logger.error('[LinkedIn Account Lookup] Error getting all LinkedIn accounts', { error: error.message, stack: error.stack });
  }
  
  return accounts;
}

/**
 * Get LinkedIn account for execution (with fallback strategies)
 */
async function getLinkedInAccountForExecution(tenantId, userId) {
  let accountResult;
  
  const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(null);
  
  try {
    accountResult = await pool.query(
      `SELECT id, unipile_account_id FROM ${schema}.linkedin_accounts 
       WHERE tenant_id = $1 
       AND is_active = TRUE
       AND unipile_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    logger.info('[LinkedIn Account Lookup] Found LinkedIn account(s) in linkedin_accounts', { count: accountResult.rows.length, tenantId });
  } catch (tddError) {
    logger.debug('[LinkedIn Account Lookup] TDD schema not found, trying old schema', { error: tddError.message });
    accountResult = { rows: [] };
  }
  
  if (accountResult.rows.length === 0 && userId) {
    logger.debug('[LinkedIn Account Lookup] No account in linkedin_accounts, checking user_integrations_voiceagent for user', { userId });
    try {
      accountResult = await pool.query(
        `SELECT id::text as id, 
                COALESCE(
                  NULLIF(credentials->>'unipile_account_id', ''),
                  NULLIF(credentials->>'account_id', ''),
                  NULLIF(credentials->>'unipileAccountId', '')
                ) as unipile_account_id 
         FROM voice_agent.user_integrations_voiceagent 
         WHERE provider = 'linkedin'
         AND (user_id::text = $1 OR user_id = $1::integer)
         AND is_connected = TRUE
         AND (
           (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
           OR
           (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
           OR
           (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
         )
         ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`,
        [userId]
      );
      logger.info('[LinkedIn Account Lookup] Found LinkedIn account(s) in user_integrations_voiceagent for user', { count: accountResult.rows.length, userId });
    } catch (err) {
      logger.warn('[LinkedIn Account Lookup] Error querying user_integrations_voiceagent', { error: err.message });
    }
  }
  
  if (accountResult.rows.length === 0 && tenantId) {
    logger.debug('[LinkedIn Account Lookup] No account found for user, checking user_integrations_voiceagent for tenant', { tenantId });
    try {
      try {
        accountResult = await pool.query(
          `SELECT uiv.id::text as id, 
                  COALESCE(
                    NULLIF(uiv.credentials->>'unipile_account_id', ''),
                    NULLIF(uiv.credentials->>'account_id', ''),
                    NULLIF(uiv.credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent uiv
           JOIN voice_agent.users_voiceagent uva ON uiv.user_id = uva.user_id
           WHERE uiv.provider = 'linkedin'
           AND uva.tenant_id = $1::uuid
           AND uiv.is_connected = TRUE
           AND (
             (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
             OR
             (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
             OR
             (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
          [tenantId]
        );
      } catch (uuidError) {
        if (uuidError.message && uuidError.message.includes('operator does not exist')) {
          accountResult = await pool.query(
            `SELECT uiv.id::text as id, 
                    COALESCE(
                      NULLIF(uiv.credentials->>'unipile_account_id', ''),
                      NULLIF(uiv.credentials->>'account_id', ''),
                      NULLIF(uiv.credentials->>'unipileAccountId', '')
                    ) as unipile_account_id 
             FROM voice_agent.user_integrations_voiceagent uiv
             JOIN voice_agent.users_voiceagent uva ON uiv.user_id = uva.user_id
             WHERE uiv.provider = 'linkedin'
             AND uva.tenant_id = $1::integer
             AND uiv.is_connected = TRUE
             AND (
               (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
               OR
               (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
               OR
               (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
             )
             ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
            [tenantId]
          );
        } else {
          throw uuidError;
        }
      }
      logger.info('[LinkedIn Account Lookup] Found LinkedIn account(s) in user_integrations_voiceagent for tenant', { count: accountResult.rows.length, tenantId });
    } catch (err) {
      logger.warn('[LinkedIn Account Lookup] Error querying user_integrations_voiceagent by tenant', { error: err.message });
    }
  }
  
  if (accountResult.rows.length === 0) {
    logger.debug('[LinkedIn Account Lookup] No account found for tenant/user, searching for any active account in linkedin_accounts');
    try {
      accountResult = await pool.query(
        `SELECT id, unipile_account_id FROM ${schema}.linkedin_accounts 
         WHERE is_active = TRUE
         AND unipile_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      logger.info('[LinkedIn Account Lookup] Found active LinkedIn account(s) globally in linkedin_accounts', { count: accountResult.rows.length });
    } catch (tddError) {
      try {
        accountResult = await pool.query(
          `SELECT id, unipile_account_id FROM linkedin_accounts 
           WHERE is_active = TRUE
           AND unipile_account_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`
        );
        logger.info('[LinkedIn Account Lookup] Found active LinkedIn account(s) globally in linkedin_accounts', { count: accountResult.rows.length });
      } catch (fallbackError) {
        logger.warn('[LinkedIn Account Lookup] Error querying linkedin_accounts', { error: fallbackError.message });
      }
    }
  }
  
  if (accountResult.rows.length === 0) {
    logger.debug('[LinkedIn Account Lookup] No account in linkedin_accounts, searching for any active account in user_integrations_voiceagent');
    try {
      accountResult = await pool.query(
        `SELECT id::text as id, 
                COALESCE(
                  NULLIF(credentials->>'unipile_account_id', ''),
                  NULLIF(credentials->>'account_id', ''),
                  NULLIF(credentials->>'unipileAccountId', '')
                ) as unipile_account_id 
         FROM voice_agent.user_integrations_voiceagent 
         WHERE provider = 'linkedin'
         AND is_connected = TRUE
         AND (
           (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
           OR
           (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
           OR
           (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
         )
         ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`
      );
      logger.info('[LinkedIn Account Lookup] Found active LinkedIn account(s) globally in user_integrations_voiceagent', { count: accountResult.rows.length });
    } catch (err) {
      logger.warn('[LinkedIn Account Lookup] Error querying user_integrations_voiceagent globally', { error: err.message });
    }
  }
  
  if (accountResult.rows.length === 0) {
    return null;
  }
  
  return accountResult.rows[0].unipile_account_id;
}

module.exports = {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution
};
