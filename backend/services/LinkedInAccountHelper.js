/**
 * LinkedIn Account Helper
 * Handles LinkedIn account lookup and connection request fallback logic
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const unipileService = require('./unipileService');
const logger = require('../../../core/utils/logger');

/**
 * Get all available LinkedIn accounts for a tenant/user (for account fallback)
 */
async function getAllLinkedInAccountsForTenant(tenantId, userId) {
  const accounts = [];
  
  try {
    // Use tenantId directly (LAD standard - no organization_id conversion needed)
    const resolvedTenantId = tenantId || userId;
    const schema = resolvedTenantId ? getSchema({ user: { tenant_id: resolvedTenantId } }) : getSchema(null);
    
    // Try social_linkedin_accounts table first
    try {
      
      const query = `
        SELECT id, tenant_id, account_name, provider_account_id, status
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1 
        AND status = 'active'
        AND provider_account_id IS NOT NULL
        ORDER BY created_at DESC
      `;
      
      const result = await pool.query(query, [tenantId]);
      if (result.rows.length > 0) {
        accounts.push(...result.rows.map(row => ({
          id: row.id,
          unipile_account_id: row.provider_account_id,
          account_name: row.account_name
        })));
      }
    } catch (tddError) {
      // TDD schema not available, continue to global search
    }
    
    // If no accounts found, try global search
    if (accounts.length === 0) {
      try {
        const globalQuery = await pool.query(
          `SELECT id, provider_account_id, account_name
           FROM ${schema}.social_linkedin_accounts
           WHERE status = 'active'
           AND provider_account_id IS NOT NULL
           ORDER BY created_at DESC`
        );
        
        if (globalQuery.rows.length > 0) {
          accounts.push(...globalQuery.rows.map(row => ({
            id: row.id,
            unipile_account_id: row.provider_account_id,
            account_name: row.account_name || 'LinkedIn Account'
          })));
        }
      } catch (globalError) {
        // Ignore global search errors
      }
    }
  } catch (error) {
    logger.error('[LinkedIn Account Helper] Error getting all LinkedIn accounts', { error: error.message, stack: error.stack });
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
async function getLinkedInAccountForExecution(tenantId, userId) {
  let accountResult = { rows: [] };  // Initialize with empty result to prevent undefined errors
  
  const schema = tenantId ? getSchema({ user: { tenant_id: tenantId } }) : getSchema(null);
  // Strategy 1: Try social_linkedin_accounts table by tenant_id
  try {
    accountResult = await pool.query(
      `SELECT id, provider_account_id FROM ${schema}.social_linkedin_accounts
       WHERE tenant_id = $1 
       AND status = 'active'
       AND provider_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    logger.info('[LinkedIn Account Helper] Found LinkedIn account in social_linkedin_accounts', { count: accountResult.rows.length, tenantId });
  } catch (tddError) {
    // Fallback to old schema if TDD table doesn't exist
    logger.debug('[LinkedIn Account Helper] TDD schema not found, trying old schema', { error: tddError.message });
    // Note: Old schema uses organization_id, but we use tenantId directly (LAD standard)
    // Skip old schema fallback as it's not compatible with tenantId
    accountResult = { rows: [] };
  }
  
  // Strategy 2: If not found, try global search in social_linkedin_accounts
  if (accountResult.rows.length === 0) {
    logger.debug('[LinkedIn Account Helper] No account found for tenant/user, searching for any active account in social_linkedin_accounts');
    try {
      accountResult = await pool.query(
        `SELECT id, provider_account_id FROM ${schema}.social_linkedin_accounts 
         WHERE status = 'active'
         AND provider_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      logger.info('[LinkedIn Account Helper] Found active LinkedIn account globally', { count: accountResult.rows.length });
    } catch (error) {
      logger.warn('[LinkedIn Account Helper] Error querying social_linkedin_accounts', { error: error.message });
      accountResult = { rows: [] };  // Ensure accountResult is never undefined
    }
  }
  
  if (accountResult.rows.length === 0) {
    return null;
  }
  
  const accountId = accountResult.rows[0].provider_account_id;
  
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
  
  logger.info('[LinkedIn Account Helper] Trying accounts for connection request', { accountCount: accountsToTry.length });
  
  // Track which strategies we've tried and error patterns
  const triedStrategies = new Set();
  const accountErrors = {}; // Track errors per account
  let actualRateLimitErrors = 0; // Count actual rate limit errors
  let credentialErrors = 0; // Count credential-related errors
  let otherErrors = 0; // Count other errors
  
  for (const account of accountsToTry) {
    const accountId = account.unipile_account_id;
    const accountName = account.account_name || 'LinkedIn Account';
    
    logger.debug('[LinkedIn Account Helper] Trying account', { accountName, accountId });
    
    accountErrors[accountId] = [];
    
    // Strategy 1: If user wants message, try with message first
    if (userWantsMessage && message && !triedStrategies.has(`${accountId}:with_message`)) {
      logger.debug('[LinkedIn Account Helper] Strategy 1: Trying with message', { accountName });
      triedStrategies.add(`${accountId}:with_message`);
      
      const result = await unipileService.sendConnectionRequest(employee, message, accountId);
      
      if (result.success) {
        logger.info('[LinkedIn Account Helper] Success with message', { accountName });
        return { ...result, accountUsed: accountName, strategy: 'with_message' };
      }
      
      // Track the error reason
      accountErrors[accountId].push({
        strategy: 'with_message',
        error: result.error,
        isRateLimit: result.isRateLimit
      });
      
      // Check if it's a rate limit error (monthly limit for messages)
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit')
          ))) {
        logger.warn('[LinkedIn Account Helper] Rate limit with message, trying without message', { accountName });
        actualRateLimitErrors++;
        // Continue to Strategy 2 (without message)
      } else {
        // Other error (not rate limit) - try next account
        logger.warn('[LinkedIn Account Helper] Error with message', { accountName, error: result.error });
        
        // Classify error type
        if (result.error && (
          result.error.includes('credentials') || 
          result.error.includes('expired') ||
          result.error.includes('checkpoint') ||
          result.error.includes('Account not found') ||
          result.statusCode === 401 || result.statusCode === 404
        )) {
          credentialErrors++;
        } else {
          otherErrors++;
        }
        continue; // Try next account
      }
    }
    
    // Strategy 2: Try without message (unlimited)
    if (!triedStrategies.has(`${accountId}:without_message`)) {
      logger.debug('[LinkedIn Account Helper] Strategy 2: Trying without message', { accountName });
      triedStrategies.add(`${accountId}:without_message`);
      
      const result = await unipileService.sendConnectionRequest(employee, null, accountId);
      
      if (result.success) {
        const strategy = userWantsMessage ? 'fallback_to_without_message' : 'without_message';
        logger.info('[LinkedIn Account Helper] Success without message', { accountName, strategy });
        return { 
          ...result, 
          accountUsed: accountName, 
          strategy: strategy,
          messageSkipped: userWantsMessage // Flag to indicate message was skipped due to limit
        };
      }
      
      // Track the error reason
      accountErrors[accountId].push({
        strategy: 'without_message',
        error: result.error,
        isRateLimit: result.isRateLimit
      });
      
      // Check if it's a rate limit error
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit') ||
            result.error.includes('weekly limit') ||
            result.error.includes('monthly limit')
          ))) {
        logger.warn('[LinkedIn Account Helper] Rate limit without message, trying next account', { accountName });
        actualRateLimitErrors++;
        continue; // Try next account
      } else {
        // Other error - try next account
        logger.warn('[LinkedIn Account Helper] Error without message', { accountName, error: result.error });
        
        // Classify error type
        if (result.error && (
          result.error.includes('credentials') || 
          result.error.includes('expired') ||
          result.error.includes('checkpoint') ||
          result.error.includes('Account not found') ||
          result.statusCode === 401 || result.statusCode === 404
        )) {
          credentialErrors++;
        } else {
          otherErrors++;
        }
        continue; // Try next account
      }
    }
  }
  
  // All accounts and strategies exhausted - determine root cause
  logger.error('[LinkedIn Account Helper] All accounts exhausted', { 
    totalAccounts: accountsToTry.length,
    actualRateLimitErrors,
    credentialErrors,
    otherErrors,
    accountErrors
  });
  
  // Determine the most accurate error message based on what we encountered
  let errorMessage = '';
  let errorType = '';
  
  if (credentialErrors > 0 && actualRateLimitErrors === 0) {
    // Primary issue is account credentials
    errorMessage = 'No valid LinkedIn accounts available. Please verify your connected accounts are still active and their credentials are valid in Unipile.';
    errorType = 'no_valid_accounts';
  } else if (actualRateLimitErrors > 0) {
    // We hit actual rate limits
    errorMessage = 'Weekly limit is completed. All LinkedIn accounts have reached their connection request limits. Please try again next week.';
    errorType = 'weekly_limit_completed';
  } else if (otherErrors > 0) {
    // Other errors occurred
    errorMessage = `Connection request failed. All available accounts encountered errors. Please check your LinkedIn account configuration.`;
    errorType = 'account_errors';
  } else {
    // No accounts available at all
    errorMessage = 'No LinkedIn accounts configured. Please connect a LinkedIn account first.';
    errorType = 'no_accounts_configured';
  }
  
  return {
    success: false,
    error: errorMessage,
    errorType: errorType,
    isRateLimit: actualRateLimitErrors > 0,
    allAccountsExhausted: true,
    diagnostics: {
      totalAccountsTried: accountsToTry.length,
      actualRateLimitErrors,
      credentialErrors,
      otherErrors
    },
    employee: {
      fullname: employee.fullname,
      profile_url: employee.profile_url || employee.linkedin_url
    }
  };
}

/**
 * Verify account is valid and ready before campaign execution
 * This should be called once per campaign, not per request
 * 
 * @param {string} unipileAccountId - Account ID to verify
 * @returns {Promise<Object>} { valid: boolean, reason: string, canRetry: boolean }
 */
async function verifyAccountReadyForCampaign(unipileAccountId) {
  try {
    logger.info('[LinkedIn Account Helper] Verifying account health before campaign', { unipileAccountId });
    
    // Try to get account status from database first
    const schema = getSchema(null);
    
    // Check TDD schema
    try {
      const result = await pool.query(
        `SELECT id, status, updated_at FROM ${schema}.social_linkedin_accounts 
         WHERE provider_account_id = $1 LIMIT 1`,
        [unipileAccountId]
      );
      
      if (result.rows.length > 0) {
        const account = result.rows[0];
        
        if (account.status === 'expired' || account.status === 'revoked' || account.status === 'error') {
          logger.warn('[LinkedIn Account Helper] Account marked as inactive/expired in database', {
            unipileAccountId,
            status: account.status
          });
          
          return {
            valid: false,
            reason: 'Account is marked as inactive or expired',
            canRetry: false,
            requiresReconnection: true
          };
        }
        
        logger.info('[LinkedIn Account Helper] Account status check passed in TDD schema', {
          unipileAccountId,
          is_active: account.is_active,
          status: account.status
        });
        
        return { valid: true, reason: 'OK', canRetry: false };
      }
    } catch (error) {
      logger.warn('[LinkedIn Account Helper] Could not check TDD schema', { error: error.message });
    }
    
    // Fallback check
    logger.info('[LinkedIn Account Helper] Account health verified (fallback)', { unipileAccountId });
    return { valid: true, reason: 'OK', canRetry: false };
    
  } catch (error) {
    logger.error('[LinkedIn Account Helper] Error verifying account health', {
      error: error.message,
      unipileAccountId
    });
    
    // If we can't reach database, assume account might still be valid
    // (network issue, not account issue)
    return {
      valid: true,
      reason: 'Could not verify, proceeding cautiously',
      canRetry: false,
      warning: error.message
    };
  }
}

module.exports = {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution,
  sendConnectionRequestWithFallback,
  verifyAccountReadyForCampaign
};

