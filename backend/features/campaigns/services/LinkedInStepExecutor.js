/**
 * LinkedIn Step Executor
 * Handles all LinkedIn-related step executions
 */

const { pool } = require('../../../shared/database/connection');
const unipileService = require('./unipileService');
const { getLeadData } = require('./StepExecutors');
const {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution,
  sendConnectionRequestWithFallback
} = require('./LinkedInAccountHelper');
const { generateAndSaveProfileSummary } = require('./LinkedInProfileSummaryService');
const logger = require('../../../core/utils/logger');

/**
 * Execute LinkedIn step
 */
async function executeLinkedInStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    logger.info('[Campaign Execution] Executing LinkedIn step', { stepType, leadId: campaignLead?.id, userId, tenantId });
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      logger.error('[Campaign Execution] Lead data not found', { leadId: campaignLead.id });
      return { success: false, error: 'Lead not found' };
    }
    
    const linkedinUrl = leadData.linkedin_url || leadData.employee_linkedin_url;
    if (!linkedinUrl) {
      logger.error('[Campaign Execution] LinkedIn URL not found for lead', { leadId: campaignLead.id, leadDataKeys: Object.keys(leadData) });
      return { success: false, error: 'LinkedIn URL not found for lead' };
    }
    
    logger.debug('[Campaign Execution] Found LinkedIn URL', { linkedinUrl, leadId: campaignLead.id });
    
    // Get LinkedIn account with Unipile account ID (using helper)
    const linkedinAccountId = await getLinkedInAccountForExecution(tenantId, userId);
    
    if (!linkedinAccountId) {
      logger.error('[Campaign Execution] No active LinkedIn account connected with Unipile', { tenantId });
      return { 
        success: false, 
        error: 'No active LinkedIn account connected with Unipile. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
        userAction: 'Connect LinkedIn account in Settings'
      };
    }
    
    logger.info('[Campaign Execution] Using LinkedIn account', { unipileAccountId: linkedinAccountId });
    
    // Format employee for Unipile
    const employee = {
      profile_url: linkedinUrl,
      fullname: leadData.name || leadData.employee_name || 'Unknown',
      first_name: (leadData.name || leadData.employee_name || 'Unknown').split(' ')[0],
      last_name: (leadData.name || leadData.employee_name || 'Unknown').split(' ').slice(1).join(' '),
      public_identifier: linkedinUrl?.match(/linkedin\.com\/in\/([^\/\?]+)/)?.[1]
    };
    
    let result;
    
    // Handle all LinkedIn step types dynamically
    if (stepType === 'linkedin_connect') {
      // LinkedIn allows unlimited connection requests WITHOUT messages
      // But only 4-5 connection requests WITH messages per month
      // User can select "send with message" in UI - if limit exceeded, fallback to without message
      const userWantsMessage = stepConfig.sendWithMessage === true || stepConfig.sendWithMessage === 'true' || stepConfig.connectionMessage !== null;
      const message = stepConfig.message || stepConfig.connectionMessage || null;
      
      logger.debug('[Campaign Execution] LinkedIn connect step', { userWantsMessage, hasMessage: !!message });
      
      // Get all available LinkedIn accounts for fallback
      const allAccounts = await getAllLinkedInAccountsForTenant(tenantId, userId);
      logger.info('[Campaign Execution] Found LinkedIn accounts available for fallback', { count: allAccounts.length });
      
      // Try connection request with smart fallback logic
      result = await sendConnectionRequestWithFallback(
        employee,
        message,
        userWantsMessage,
        linkedinAccountId,
        allAccounts
      );
      
      // Add 10-second delay after sending connection request to avoid rate limiting
      // This prevents sending requests too fast and hitting LinkedIn's rate limits
      // Delay applies regardless of success/failure to maintain consistent rate
      logger.debug('[Campaign Execution] Waiting 10 seconds before next connection request to avoid rate limits');
      await new Promise(resolve => setTimeout(resolve, 10000));
      logger.debug('[Campaign Execution] Delay complete, ready for next request');
    } else if (stepType === 'linkedin_message') {
      const message = stepConfig.message || stepConfig.body || 'Hello!';
      logger.info('[Campaign Execution] LinkedIn message step - sending message', { employeeName: employee.fullname });
      result = await unipileService.sendLinkedInMessage(employee, message, linkedinAccountId);
    } else if (stepType === 'linkedin_follow') {
      logger.info('[Campaign Execution] LinkedIn follow step', { employeeName: employee.fullname });
      result = await unipileService.followLinkedInProfile(employee, linkedinAccountId);
    } else if (stepType === 'linkedin_visit') {
      logger.info('[Campaign Execution] LinkedIn visit step - fetching profile via Unipile', { employeeName: employee.fullname, linkedinUrl, unipileAccountId: linkedinAccountId });
      
      // Validate inputs before making API call
      if (!linkedinUrl) {
        logger.error('[Campaign Execution] LinkedIn URL is missing', { employeeName: employee.fullname });
        result = { success: false, error: 'LinkedIn URL is required' };
        return result;
      }
      
      if (!linkedinAccountId) {
        logger.error('[Campaign Execution] LinkedIn account ID is missing', { employeeName: employee.fullname });
        result = { success: false, error: 'LinkedIn account ID is required' };
        return result;
      }
      
      // Check if Unipile service is configured
      if (!unipileService.isConfigured()) {
        logger.error('[Campaign Execution] Unipile service is not configured');
        result = { success: false, error: 'Unipile service is not configured' };
        return result;
      }
      
      // Use Unipile profile lookup as a real "visit" and to hydrate contact info
      try {
        logger.debug('[Campaign Execution] Calling Unipile API', { employeeName: employee.fullname });
        const startTime = Date.now();
        const profileResult = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
        const duration = Date.now() - startTime;
        logger.info('[Campaign Execution] Unipile API call completed', { employeeName: employee.fullname, duration });
        
        // Check if account credentials expired
        if (profileResult && profileResult.accountExpired) {
          logger.warn('[Campaign Execution] Account credentials expired, trying to find another account', { accountId: linkedinAccountId });
          
          // Try to get another active account
          const allAccounts = await getAllLinkedInAccountsForTenant(tenantId, userId);
          const otherAccount = allAccounts.find(acc => acc.unipile_account_id !== linkedinAccountId);
          
          if (otherAccount && otherAccount.unipile_account_id) {
            logger.info('[Campaign Execution] Retrying with another account', { accountId: otherAccount.unipile_account_id });
            const retryResult = await unipileService.getLinkedInContactDetails(linkedinUrl, otherAccount.unipile_account_id);
            
            if (retryResult && retryResult.success !== false) {
              logger.info('[Campaign Execution] Successfully visited profile via fallback account', { employeeName: employee.fullname });
              result = {
                success: true,
                message: 'Profile visited via Unipile and contact details fetched',
                profile: retryResult.profile || retryResult
              };
              
              const profileData = retryResult.profile || retryResult;
              await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
            } else {
              logger.error('[Campaign Execution] All LinkedIn accounts have expired credentials');
              result = {
                success: false,
                error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
                accountExpired: true
              };
            }
          } else {
            logger.error('[Campaign Execution] No other active LinkedIn accounts available');
            result = {
              success: false,
              error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
              accountExpired: true
            };
          }
        } else if (profileResult && profileResult.success !== false) {
          logger.info('[Campaign Execution] Successfully visited profile via Unipile', { employeeName: employee.fullname });
          result = {
            success: true,
            message: 'Profile visited via Unipile and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          
          // After successfully visiting profile, generate summary automatically
          const profileData = profileResult.profile || profileResult;
          await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
        } else {
          logger.error('[Campaign Execution] Failed to visit profile', { employeeName: employee.fullname, error: profileResult?.error || 'Unknown error' });
          result = {
            success: false,
            error: profileResult?.error || 'Failed to fetch LinkedIn profile via Unipile'
          };
        }
      } catch (visitErr) {
        logger.error('[Campaign Execution] Error during LinkedIn visit via Unipile', { employeeName: employee.fullname, error: visitErr.message, stack: visitErr.stack });
        result = { success: false, error: visitErr.message || 'LinkedIn visit failed' };
      }
    } else {
      // For other LinkedIn steps (scrape_profile, company_search, employee_list, autopost, comment_reply)
      logger.debug('[Campaign Execution] LinkedIn step recorded for future implementation', { stepType });
      result = { success: true, message: `LinkedIn step ${stepType} recorded` };
    }
    
    return result;
  } catch (error) {
    logger.error('[Campaign Execution] LinkedIn step error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

module.exports = {
  executeLinkedInStep
};

