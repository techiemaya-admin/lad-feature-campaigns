/**
 * LinkedIn Account Helper
 * Handles connection request fallback logic
 */

const unipileService = require('./unipileService');
const logger = require('../../../core/utils/logger');
const accountLookup = require('./LinkedInAccountLookup');
const accountVerification = require('./LinkedInAccountVerification');

const getAllLinkedInAccountsForTenant = accountLookup.getAllLinkedInAccountsForTenant;
const getLinkedInAccountForExecution = accountLookup.getLinkedInAccountForExecution;
const verifyAccountHealth = accountVerification.verifyAccountHealth;

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
  const fallbackAccounts = allAccounts.filter(acc => acc.unipile_account_id !== primaryAccountId);
  const accountsToTry = [
    { unipile_account_id: primaryAccountId, account_name: 'Primary Account' },
    ...fallbackAccounts
  ];
  
  logger.info('[LinkedIn Account Helper] Trying accounts for connection request', { accountCount: accountsToTry.length });
  
  const triedStrategies = new Set();
  
  for (const account of accountsToTry) {
    const accountId = account.unipile_account_id;
    const accountName = account.account_name || 'LinkedIn Account';
    
    logger.debug('[LinkedIn Account Helper] Trying account', { accountName, accountId });
    
    if (userWantsMessage && message && !triedStrategies.has(`${accountId}:with_message`)) {
      logger.debug('[LinkedIn Account Helper] Strategy 1: Trying with message', { accountName });
      triedStrategies.add(`${accountId}:with_message`);
      
      const result = await unipileService.sendConnectionRequest(employee, message, accountId);
      
      if (result.success) {
        logger.info('[LinkedIn Account Helper] Success with message', { accountName });
        return { ...result, accountUsed: accountName, strategy: 'with_message' };
      }
      
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit')
          ))) {
        logger.warn('[LinkedIn Account Helper] Rate limit with message, trying without message', { accountName });
      } else {
        logger.warn('[LinkedIn Account Helper] Error with message', { accountName, error: result.error });
        continue;
      }
    }
    
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
          messageSkipped: userWantsMessage
        };
      }
      
      if (result.isRateLimit || 
          (result.error && (
            result.error.includes('limit') || 
            result.error.includes('cannot_resend_yet') ||
            result.error.includes('provider limit') ||
            result.error.includes('weekly limit') ||
            result.error.includes('monthly limit')
          ))) {
        logger.warn('[LinkedIn Account Helper] Rate limit without message, trying next account', { accountName });
        continue;
      } else {
        logger.warn('[LinkedIn Account Helper] Error without message', { accountName, error: result.error });
        continue;
      }
    }
  }
  
  logger.error('[LinkedIn Account Helper] All accounts exhausted. Weekly/monthly limit reached for all LinkedIn accounts');
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
  verifyAccountHealth,
  sendConnectionRequestWithFallback
};

