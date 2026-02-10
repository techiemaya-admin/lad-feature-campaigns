/**
 * LinkedIn Account Helper
 * Handles LinkedIn account lookup and connection request fallback logic
 * 
 * LAD Architecture: Service Layer (NO SQL)
 * - Business logic only
 * - Calls repository for data access
 * - Orchestrates account selection and fallback
 */
const { pool } = require('../../../shared/database/connection');
const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
const unipileService = require('./unipileService');
const logger = require('../../../core/utils/logger');

// Initialize repository
const linkedInAccountRepository = new LinkedInAccountRepository(pool);

/**
 * Get all available LinkedIn accounts for a tenant/user (for account fallback)
 */
async function getAllLinkedInAccountsForTenant(tenantId, userId) {
  try {
    // Use tenantId directly (LAD standard - no organization_id conversion needed)
    const resolvedTenantId = tenantId || userId;
    
    // CRITICAL: Always filter by tenant_id for tenant isolation
    if (!tenantId) {
      logger.warn('[LinkedInAccountHelper] No tenantId provided - cannot retrieve accounts');
      return [];
    }
    
    // Call repository to get accounts (repository handles SQL)
    const accounts = await linkedInAccountRepository.getAllAccountsForTenant(
      tenantId, 
      { user: { tenant_id: resolvedTenantId } }
    );
    
    if (accounts.length > 0) {
      logger.info('[LinkedInAccountHelper] Found LinkedIn accounts for tenant', {
        tenantId,
        accountCount: accounts.length,
        accountNames: accounts.map(a => a.account_name)
      });
    } else {
      logger.warn('[LinkedInAccountHelper] No LinkedIn accounts found for tenant', {
        tenantId
      });
    }
    
    return accounts;
    
  } catch (error) {
    logger.error('[LinkedInAccountHelper] Error in getAllLinkedInAccountsForTenant', {
      tenantId,
      error: error.message
    });
    return [];
  }
}
/**
 * Verify account health with Unipile
 */
async function verifyAccountHealth(unipileAccountId) {
  try {
    const unipileService = require('./unipileService');
    const baseService = unipileService.base;
    if (!baseService.isConfigured()) {
      return { valid: false, error: 'LinkedIn service not configured' };
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
      return { valid: false, error: 'LinkedIn account not found', notFound: true };
    }
    // For other errors, assume account might be valid (network issues, etc.)
    return { valid: true, warning: error.message };
  }
}
/**
 * Get LinkedIn account for execution (with fallback strategies)
 * @returns {Object|null} - Returns { provider_account_id, account_name } or null
 */
async function getLinkedInAccountForExecution(tenantId, userId) {
  // Call repository to get primary account (repository handles SQL)
  const account = await linkedInAccountRepository.getPrimaryAccountForTenant(
    tenantId,
    { user: { tenant_id: tenantId || userId } }
  );

  if (!account) {
    logger.warn('[LinkedInAccountHelper] No LinkedIn account found for tenant', {
      tenantId,
      userId
    });
  }

  return account;
}
/**
 * Send connection request with smart fallback:
 * 1. If user wants message: Try with message first
 * 2. If limit exceeded: Fallback to without message
 * 3. If still fails: Try another account
 * 4. If all accounts exhausted: Return error for UI
 * 
 * @param {Object} options - Options object
 * @param {string} options.tenantId - Tenant ID for credit deduction
 */
async function sendConnectionRequestWithFallback(
  employee,
  message,
  userWantsMessage,
  primaryAccountId,
  allAccounts,
  options = {}
) {
  const { tenantId } = options;
  
  logger.info('[LinkedInAccountHelper] sendConnectionRequestWithFallback called', {
    employeeUrl: employee.profile_url,
    employeeName: employee.fullname,
    hasMessage: !!message,
    userWantsMessage,
    primaryAccountId,
    totalAccounts: allAccounts?.length || 0,
    tenantId
  });
  
  // Filter out the primary account from fallback list
  const fallbackAccounts = allAccounts.filter(acc => acc.unipile_account_id !== primaryAccountId);
  const accountsToTry = [
    { unipile_account_id: primaryAccountId, account_name: 'Primary Account' },
    ...fallbackAccounts
  ];
  // Track which strategies we've tried and error patterns
  const triedStrategies = new Set();
  const accountErrors = {}; // Track errors per account
  let actualRateLimitErrors = 0; // Count actual rate limit errors
  let credentialErrors = 0; // Count credential-related errors
  let otherErrors = 0; // Count other errors
  for (const account of accountsToTry) {
    const accountId = account.unipile_account_id;
    const accountName = account.account_name || 'LinkedIn Account';
    accountErrors[accountId] = [];
    // Strategy 1: If user wants message, try with message first
    if (userWantsMessage && message && !triedStrategies.has(`${accountId}:with_message`)) {
      triedStrategies.add(`${accountId}:with_message`);
      
      logger.info('[LinkedInAccountHelper] Trying connection with message', {
        accountId,
        accountName,
        employeeName: employee.fullname
      });
      
      const result = await unipileService.sendConnectionRequest(employee, message, accountId, { tenantId });
      
      logger.info('[LinkedInAccountHelper] Connection with message result', {
        accountId,
        success: result.success,
        error: result.error,
        isRateLimit: result.isRateLimit
      });
      
      if (result.success) {
        logger.info('[LinkedInAccountHelper] Connection request successful with message', {
          accountName,
          employeeName: employee.fullname
        });
        return { 
          ...result, 
          accountUsed: accountName, 
          accountInfo: {
            account_name: accountName,
            provider_account_id: accountId
          },
          strategy: 'with_message' 
        };
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
        actualRateLimitErrors++;
        // Continue to Strategy 2 (without message)
      } else {
        // Other error (not rate limit) - try next account
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
      triedStrategies.add(`${accountId}:without_message`);
      
      logger.info('[LinkedInAccountHelper] Trying connection without message', {
        accountId,
        accountName,
        employeeName: employee.fullname
      });
      
      const result = await unipileService.sendConnectionRequest(employee, null, accountId, { tenantId });
      
      logger.info('[LinkedInAccountHelper] Connection without message result', {
        accountId,
        success: result.success,
        error: result.error,
        isRateLimit: result.isRateLimit
      });
      
      if (result.success) {
        const strategy = userWantsMessage ? 'fallback_to_without_message' : 'without_message';
        logger.info('[LinkedInAccountHelper] Connection request successful without message', {
          accountName,
          employeeName: employee.fullname,
          strategy
        });
        return { 
          ...result, 
          accountUsed: accountName,
          accountInfo: {
            account_name: accountName,
            provider_account_id: accountId
          },
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
        actualRateLimitErrors++;
        continue; // Try next account
      } else {
        // Other error - try next account
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
  
  // Determine the most accurate error message based on what we encountered
  let errorMessage = '';
  let errorType = '';
  if (credentialErrors > 0 && actualRateLimitErrors === 0) {
    // Primary issue is account credentials
    errorMessage = 'No valid LinkedIn accounts available. Please verify your connected accounts are still active and their credentials are valid in Settings → LinkedIn Integration.';
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
    // Call repository to check account status (repository handles SQL)
    const accountStatus = await linkedInAccountRepository.checkAccountStatus(
      unipileAccountId,
      {}
    );

    if (accountStatus.exists) {
      if (accountStatus.status === 'expired' || accountStatus.status === 'revoked' || accountStatus.status === 'error') {
        return {
          valid: false,
          reason: 'Account is marked as inactive or expired',
          canRetry: false,
          requiresReconnection: true
        };
      }
      return { valid: true, reason: 'OK', canRetry: false };
    }

    // Account not found - assume it might still be valid (possibly registered elsewhere)
    return { valid: true, reason: 'OK', canRetry: false };
  } catch (error) {
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
