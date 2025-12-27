/**
 * LinkedIn Account Helper
 * Handles LinkedIn account lookup and connection request fallback logic
 */

const { pool } = require('../utils/dbConnection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const unipileService = require('./unipileService');

/**
 * Get all available LinkedIn accounts for a tenant/user (for account fallback)
 */
async function getAllLinkedInAccountsForTenant(orgId, userId) {
  const accounts = [];
  
  try {
    const schema = getSchema(req);
    // Try TDD schema first (${schema}.linkedin_accounts)
    try {
      // Get tenant_id from orgId or userId
      let tenantId = orgId || userId;
      
      // If orgId is provided, try to get tenant_id from organization
      if (orgId && !orgId.toString().includes('-')) {
        // orgId might be integer, try to get tenant_id
        try {
          const orgQuery = await pool.query(
            `SELECT tenant_id FROM voice_agent.organizations_voiceagent WHERE organization_id = $1 LIMIT 1`,
            [orgId]
          );
          if (orgQuery.rows.length > 0) {
            tenantId = orgQuery.rows[0].tenant_id;
          }
        } catch (orgErr) {
          // Organization table might not exist, use orgId as tenantId
        }
      }
      
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
    
    // Fallback: Try old schema (user_integrations_voiceagent)
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
    
    // If still no accounts, try global search
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
    console.error('[LinkedIn Account Helper] Error getting all LinkedIn accounts:', error.message);
  }
  
  return accounts;
}

/**
 * Verify account health with Unipile
 */
async function verifyAccountHealth(unipileAccountId) {
  try {
    const unipileService = require('./unipileService');
    const baseService = unipileService.base;
    
    if (!baseService.isConfigured()) {
      return { valid: false, error: 'Unipile not configured' };
    }
    
    const baseUrl = baseService.getBaseUrl();
    const headers = baseService.getAuthHeaders();
    
    // Try to get account details from Unipile
    const axios = require('axios');
    const response = await axios.get(
      `${baseUrl}/accounts/${unipileAccountId}`,
      { headers, timeout: 10000 }
    );
    
    const accountData = response.data?.data || response.data || {};
    
    // Check if account has checkpoint (needs re-authentication)
    if (accountData.checkpoint) {
      return { 
        valid: false, 
        error: 'Account requires checkpoint resolution',
        hasCheckpoint: true,
        checkpointType: accountData.checkpoint.type
      };
    }
    
    // Check account state/status
    const state = accountData.state || accountData.status || '';
    if (state === 'disconnected' || state === 'error' || state === 'expired') {
      return { valid: false, error: `Account state: ${state}` };
    }
    
    return { valid: true, account: accountData };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      return { valid: false, error: 'Account credentials expired', expired: true };
    }
    if (error.response && error.response.status === 404) {
      return { valid: false, error: 'Account not found in Unipile', notFound: true };
    }
    // For other errors, assume account might be valid (network issues, etc.)
    return { valid: true, warning: error.message };
  }
}

/**
 * Get LinkedIn account for execution (with fallback strategies)
 */
async function getLinkedInAccountForExecution(orgId, userId) {
  let accountResult;
  
  const schema = getSchema(req);
  // Strategy 1: Try ${schema}.linkedin_accounts table by tenant_id (TDD schema)
  try {
    accountResult = await pool.query(
      `SELECT id, unipile_account_id FROM ${schema}.linkedin_accounts 
       WHERE tenant_id = $1 
       AND is_active = TRUE
       AND unipile_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} LinkedIn account(s) in ${schema}.linkedin_accounts for tenant ${orgId}`);
  } catch (tddError) {
    // Fallback to old schema if TDD table doesn't exist
    console.log(`[LinkedIn Account Helper] TDD schema not found, trying old schema:`, tddError.message);
    try {
      accountResult = await pool.query(
        `SELECT id, unipile_account_id FROM linkedin_accounts 
         WHERE organization_id = $1 
         AND is_active = TRUE
         AND unipile_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      );
      console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} LinkedIn account(s) in linkedin_accounts for org ${orgId}`);
    } catch (oldError) {
      console.log(`[LinkedIn Account Helper] Old schema also failed:`, oldError.message);
      accountResult = { rows: [] };
    }
  }
  
  // Strategy 2: If not found, try user_integrations_voiceagent by user_id
  if (accountResult.rows.length === 0 && userId) {
    console.log(`[LinkedIn Account Helper] No account in linkedin_accounts, checking user_integrations_voiceagent for user ${userId}...`);
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
      console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for user ${userId}`);
    } catch (err) {
      console.log(`[LinkedIn Account Helper] Error querying user_integrations_voiceagent:`, err.message);
    }
  }
  
  // Strategy 3: If still not found, try user_integrations_voiceagent by organization_id
  if (accountResult.rows.length === 0 && orgId) {
    console.log(`[LinkedIn Account Helper] No account found for user, checking user_integrations_voiceagent for org ${orgId}...`);
    try {
      // Try UUID first, then integer if that fails
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
           AND uva.organization_id = $1::uuid
           AND uiv.is_connected = TRUE
           AND (
             (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
             OR
             (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
             OR
             (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
          [orgId]
        );
      } catch (uuidError) {
        // If UUID fails, try as integer (old schema)
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
             AND uva.organization_id = $1::integer
             AND uiv.is_connected = TRUE
             AND (
               (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
               OR
               (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
               OR
               (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
             )
             ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
            [orgId]
          );
        } else {
          throw uuidError;
        }
      }
      console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for org ${orgId}`);
    } catch (err) {
      console.log(`[LinkedIn Account Helper] Error querying user_integrations_voiceagent by org:`, err.message);
    }
  }
  
  // Strategy 4: If still not found, try any active account in linkedin_accounts (TDD schema)
  if (accountResult.rows.length === 0) {
    console.log(`[LinkedIn Account Helper] No account found for org/user, searching for any active account in linkedin_accounts...`);
    try {
      accountResult = await pool.query(
        `SELECT id, unipile_account_id FROM ${schema}.linkedin_accounts 
         WHERE is_active = TRUE
         AND unipile_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} active LinkedIn account(s) globally in ${schema}.linkedin_accounts`);
    } catch (tddError) {
      // Fallback to old schema if TDD table doesn't exist
      try {
        accountResult = await pool.query(
          `SELECT id, unipile_account_id FROM linkedin_accounts 
           WHERE is_active = TRUE
           AND unipile_account_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`
        );
        console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} active LinkedIn account(s) globally in linkedin_accounts`);
      } catch (fallbackError) {
        console.log(`[LinkedIn Account Helper] Error querying linkedin_accounts:`, fallbackError.message);
      }
    }
  }
  
  // Strategy 5: Last resort - try any active account in user_integrations_voiceagent
  if (accountResult.rows.length === 0) {
    console.log(`[LinkedIn Account Helper] No account in linkedin_accounts, searching for any active account in user_integrations_voiceagent...`);
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
      console.log(`[LinkedIn Account Helper] Found ${accountResult.rows.length} active LinkedIn account(s) globally in user_integrations_voiceagent`);
    } catch (err) {
      console.log(`[LinkedIn Account Helper] Error querying user_integrations_voiceagent globally:`, err.message);
    }
  }
  
  if (accountResult.rows.length === 0) {
    return null;
  }
  
  const accountId = accountResult.rows[0].unipile_account_id;
  
  // Verify account health before returning (quick check)
  // Note: We don't verify on every call to avoid performance issues
  // Instead, we verify when we get 401 errors (handled in UnipileProfileService)
  // But we can add a periodic health check here if needed
  
  return accountId;
}

/**
 * Send connection request with smart fallback:
 * 1. If user wants message: Try with message first
 * 2. If limit exceeded: Fallback to without message
 * 3. If still fails: Try another account
 * 4. If all accounts exhausted: Return error for UI
 */
async function sendConnectionRequestWithFallback(
  employee,
  message,
  userWantsMessage,
  primaryAccountId,
  allAccounts
) {
  // Filter out the primary account from fallback list
  const fallbackAccounts = allAccounts.filter(acc => acc.unipile_account_id !== primaryAccountId);
  const accountsToTry = [
    { unipile_account_id: primaryAccountId, account_name: 'Primary Account' },
    ...fallbackAccounts
  ];
  
  console.log(`[LinkedIn Account Helper] Trying ${accountsToTry.length} account(s) for connection request`);
  
  // Track which strategies we've tried
  const triedStrategies = new Set();
  
  for (const account of accountsToTry) {
    const accountId = account.unipile_account_id;
    const accountName = account.account_name || 'LinkedIn Account';
    
    console.log(`[LinkedIn Account Helper] Trying account: ${accountName} (${accountId})`);
    
    // Strategy 1: If user wants message, try with message first
    if (userWantsMessage && message && !triedStrategies.has(`${accountId}:with_message`)) {
      console.log(`[LinkedIn Account Helper] Strategy 1: Trying with message on account ${accountName}...`);
      triedStrategies.add(`${accountId}:with_message`);
      
      const result = await unipileService.sendConnectionRequest(employee, message, accountId);
      
      if (result.success) {
        console.log(`[LinkedIn Account Helper] ✅ Success with message on account ${accountName}`);
        return { ...result, accountUsed: accountName, strategy: 'with_message' };
      }
      
      // Check if it's a rate limit error (monthly limit for messages)
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit')
          ))) {
        console.log(`[LinkedIn Account Helper] ⚠️ Rate limit with message on account ${accountName}, trying without message...`);
        // Continue to Strategy 2 (without message)
      } else {
        // Other error (not rate limit) - try next account
        console.log(`[LinkedIn Account Helper] ❌ Error with message on account ${accountName}: ${result.error}`);
        continue; // Try next account
      }
    }
    
    // Strategy 2: Try without message (unlimited)
    if (!triedStrategies.has(`${accountId}:without_message`)) {
      console.log(`[LinkedIn Account Helper] Strategy 2: Trying without message on account ${accountName}...`);
      triedStrategies.add(`${accountId}:without_message`);
      
      const result = await unipileService.sendConnectionRequest(employee, null, accountId);
      
      if (result.success) {
        const strategy = userWantsMessage ? 'fallback_to_without_message' : 'without_message';
        console.log(`[LinkedIn Account Helper] ✅ Success without message on account ${accountName} (${strategy})`);
        return { 
          ...result, 
          accountUsed: accountName, 
          strategy: strategy,
          messageSkipped: userWantsMessage // Flag to indicate message was skipped due to limit
        };
      }
      
      // Check if it's a rate limit error
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit') ||
            result.error.includes('weekly limit') ||
            result.error.includes('monthly limit')
          ))) {
        console.log(`[LinkedIn Account Helper] ⚠️ Rate limit without message on account ${accountName}, trying next account...`);
        continue; // Try next account
      } else {
        // Other error - try next account
        console.log(`[LinkedIn Account Helper] ❌ Error without message on account ${accountName}: ${result.error}`);
        continue; // Try next account
      }
    }
  }
  
  // All accounts and strategies exhausted
  console.error(`[LinkedIn Account Helper] ❌ All accounts exhausted. Weekly/monthly limit reached for all LinkedIn accounts.`);
  return {
    success: false,
    error: 'Weekly limit is completed. All LinkedIn accounts have reached their connection request limits. Please try again next week.',
    errorType: 'weekly_limit_completed',
    isRateLimit: true,
    allAccountsExhausted: true,
    employee: {
      fullname: employee.fullname,
      profile_url: employee.profile_url || employee.linkedin_url
    }
  };
}

module.exports = {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution,
  sendConnectionRequestWithFallback
};

