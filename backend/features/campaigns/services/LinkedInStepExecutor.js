/**
 * LinkedIn Step Executor
 * Handles all LinkedIn-related step executions
 */

const { pool } = require('../../../../shared/database/connection');
const unipileService = require('./unipileService');
const { getLeadData } = require('./StepExecutors');
const {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution,
  sendConnectionRequestWithFallback
} = require('./LinkedInAccountHelper');
const { generateAndSaveProfileSummary } = require('./LinkedInProfileSummaryService');

/**
 * Execute LinkedIn step
 */
async function executeLinkedInStep(stepType, stepConfig, campaignLead, userId, orgId) {
  try {
    console.log(`[Campaign Execution] Executing LinkedIn step: ${stepType}`);
    console.log(`[Campaign Execution] Campaign Lead ID: ${campaignLead?.id}, User ID: ${userId}, Org ID: ${orgId}`);
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      console.error(`[Campaign Execution] ❌ Lead data not found for lead ID: ${campaignLead.id}`);
      return { success: false, error: 'Lead not found' };
    }
    
    const linkedinUrl = leadData.linkedin_url || leadData.employee_linkedin_url;
    if (!linkedinUrl) {
      console.error(`[Campaign Execution] ❌ LinkedIn URL not found for lead ${campaignLead.id}. Lead data keys:`, Object.keys(leadData));
      return { success: false, error: 'LinkedIn URL not found for lead' };
    }
    
    console.log(`[Campaign Execution] Found LinkedIn URL: ${linkedinUrl} for lead ${campaignLead.id}`);
    
    // Get LinkedIn account with Unipile account ID (using helper)
    const linkedinAccountId = await getLinkedInAccountForExecution(orgId, userId);
    
    if (!linkedinAccountId) {
      console.error(`[Campaign Execution] ❌ No active LinkedIn account connected with Unipile. Org ID: ${orgId}`);
      console.error(`[Campaign Execution] To fix this: Go to Settings → LinkedIn Integration and connect a LinkedIn account`);
      return { 
        success: false, 
        error: 'No active LinkedIn account connected with Unipile. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
        userAction: 'Connect LinkedIn account in Settings'
      };
    }
    
    console.log(`[Campaign Execution] Using LinkedIn account with Unipile ID: ${linkedinAccountId}`);
    
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
      
      console.log(`[Campaign Execution] LinkedIn connect step - user wants message: ${userWantsMessage}, message provided: ${!!message}`);
      
      // Get all available LinkedIn accounts for fallback
      const allAccounts = await getAllLinkedInAccountsForTenant(orgId, userId);
      console.log(`[Campaign Execution] Found ${allAccounts.length} LinkedIn account(s) available for fallback`);
      
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
      console.log(`[Campaign Execution] ⏳ Waiting 10 seconds before next connection request to avoid rate limits...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      console.log(`[Campaign Execution] ✅ Delay complete, ready for next request`);
    } else if (stepType === 'linkedin_message') {
      const message = stepConfig.message || stepConfig.body || 'Hello!';
      console.log(`[Campaign Execution] LinkedIn message step - sending message to ${employee.fullname}`);
      result = await unipileService.sendLinkedInMessage(employee, message, linkedinAccountId);
    } else if (stepType === 'linkedin_follow') {
      console.log(`[Campaign Execution] LinkedIn follow step - following ${employee.fullname}`);
      result = await unipileService.followLinkedInProfile(employee, linkedinAccountId);
    } else if (stepType === 'linkedin_visit') {
      console.log(`[Campaign Execution] LinkedIn visit step - fetching profile via Unipile for ${employee.fullname} (URL: ${linkedinUrl})`);
      console.log(`[Campaign Execution] Using Unipile account ID: ${linkedinAccountId}`);
      
      // Validate inputs before making API call
      if (!linkedinUrl) {
        console.error(`[Campaign Execution] ❌ LinkedIn URL is missing for ${employee.fullname}`);
        result = { success: false, error: 'LinkedIn URL is required' };
        return result;
      }
      
      if (!linkedinAccountId) {
        console.error(`[Campaign Execution] ❌ LinkedIn account ID is missing for ${employee.fullname}`);
        result = { success: false, error: 'LinkedIn account ID is required' };
        return result;
      }
      
      // Check if Unipile service is configured
      if (!unipileService.isConfigured()) {
        console.error(`[Campaign Execution] ❌ Unipile service is not configured`);
        result = { success: false, error: 'Unipile service is not configured' };
        return result;
      }
      
      // Use Unipile profile lookup as a real "visit" and to hydrate contact info
      try {
        console.log(`[Campaign Execution] Calling Unipile API for ${employee.fullname}...`);
        const startTime = Date.now();
        const profileResult = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
        const duration = Date.now() - startTime;
        console.log(`[Campaign Execution] Unipile API call completed in ${duration}ms for ${employee.fullname}`);
        
        // Check if account credentials expired
        if (profileResult && profileResult.accountExpired) {
          console.error(`[Campaign Execution] ⚠️ Account ${linkedinAccountId} credentials expired. Trying to find another account...`);
          
          // Try to get another active account
          const allAccounts = await getAllLinkedInAccountsForTenant(orgId, userId);
          const otherAccount = allAccounts.find(acc => acc.unipile_account_id !== linkedinAccountId);
          
          if (otherAccount && otherAccount.unipile_account_id) {
            console.log(`[Campaign Execution] 🔄 Retrying with another account: ${otherAccount.unipile_account_id}`);
            const retryResult = await unipileService.getLinkedInContactDetails(linkedinUrl, otherAccount.unipile_account_id);
            
            if (retryResult && retryResult.success !== false) {
              console.log(`[Campaign Execution] ✅ Successfully visited profile for ${employee.fullname} via fallback account`);
              result = {
                success: true,
                message: 'Profile visited via Unipile and contact details fetched',
                profile: retryResult.profile || retryResult
              };
              
              const profileData = retryResult.profile || retryResult;
              await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
            } else {
              console.error(`[Campaign Execution] ❌ All LinkedIn accounts have expired credentials`);
              result = {
                success: false,
                error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
                accountExpired: true
              };
            }
          } else {
            console.error(`[Campaign Execution] ❌ No other active LinkedIn accounts available`);
            result = {
              success: false,
              error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
              accountExpired: true
            };
          }
        } else if (profileResult && profileResult.success !== false) {
          console.log(`[Campaign Execution] ✅ Successfully visited profile for ${employee.fullname} via Unipile`);
          result = {
            success: true,
            message: 'Profile visited via Unipile and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          
          // After successfully visiting profile, generate summary automatically
          const profileData = profileResult.profile || profileResult;
          await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
        } else {
          console.error(`[Campaign Execution] ❌ Failed to visit profile for ${employee.fullname}: ${profileResult?.error || 'Unknown error'}`);
          result = {
            success: false,
            error: profileResult?.error || 'Failed to fetch LinkedIn profile via Unipile'
          };
        }
      } catch (visitErr) {
        console.error(`[Campaign Execution] ❌ Error during LinkedIn visit via Unipile for ${employee.fullname}:`, visitErr.message || visitErr);
        result = { success: false, error: visitErr.message || 'LinkedIn visit failed' };
      }
    } else {
      // For other LinkedIn steps (scrape_profile, company_search, employee_list, autopost, comment_reply)
      console.log(`[Campaign Execution] LinkedIn step ${stepType} - recorded for future implementation`);
      result = { success: true, message: `LinkedIn step ${stepType} recorded` };
    }
    
    return result;
  } catch (error) {
    console.error('[Campaign Execution] LinkedIn step error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  executeLinkedInStep
};

