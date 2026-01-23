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
const { campaignStatsTracker } = require('./campaignStatsTracker');
/**
 * Execute LinkedIn step
 */
async function executeLinkedInStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    // Get lead data - CRITICAL: Pass tenantId for proper tenant scoping
    const leadData = await getLeadData(campaignLead.id, null, tenantId);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    const linkedinUrl = leadData.linkedin_url 
      || leadData.employee_linkedin_url
      || (leadData.employee_data && typeof leadData.employee_data === 'string' 
          ? JSON.parse(leadData.employee_data).linkedin_url 
          : leadData.employee_data?.linkedin_url)
      || (leadData.employee_data && leadData.employee_data.linkedin)
      || (leadData.employee_data && leadData.employee_data.profile_url);
    if (!linkedinUrl) {
      return { success: false, error: 'LinkedIn URL not found for lead' };
    }
    // Get LinkedIn account with Unipile account ID (using helper)
    const linkedinAccountId = await getLinkedInAccountForExecution(tenantId, userId);
    if (!linkedinAccountId) {
      return { 
        success: false, 
        error: 'No active LinkedIn account connected with Unipile. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
        userAction: 'Connect LinkedIn account in Settings'
      };
    }
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
      // Get all available LinkedIn accounts for fallback
      const allAccounts = await getAllLinkedInAccountsForTenant(tenantId, userId);
      // Try connection request with smart fallback logic
      result = await sendConnectionRequestWithFallback(
        employee,
        message,
        userWantsMessage,
        linkedinAccountId,
        allAccounts
      );
      // Track connection request in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'CONNECTION_SENT', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null
        });
      } catch (trackErr) {
      }
      // Add 10-second delay after sending connection request to avoid rate limiting
      // This prevents sending requests too fast and hitting LinkedIn's rate limits
      // Delay applies regardless of success/failure to maintain consistent rate
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else if (stepType === 'linkedin_message') {
      const message = stepConfig.message || stepConfig.body || 'Hello!';
      // ✅ Check if connection was accepted before sending message
      try {
        const { db } = require('../../../shared/database/connection');
        const connectionCheck = await db('campaign_analytics')
          .where({
            campaign_id: campaignLead.campaign_id,
            lead_id: campaignLead.lead_id || campaignLead.id,
            action_type: 'CONNECTION_ACCEPTED',
            status: 'success'
          })
          .first();
        if (!connectionCheck) {
            leadName: employee.fullname,
            leadId: campaignLead.lead_id || campaignLead.id 
          });
          // Track as skipped (not failed, just waiting for acceptance)
          await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'MESSAGE_SKIPPED', {
            leadId: campaignLead.lead_id || campaignLead.id,
            channel: 'linkedin',
            leadName: employee.fullname,
            messageContent: message,
            status: 'skipped',
            errorMessage: 'Waiting for connection acceptance'
          });
          return {
            success: false,
            error: 'Connection not accepted yet - message will be sent after acceptance',
            skipped: true
          };
        }
      } catch (checkErr) {
        // Continue anyway if check fails (backward compatibility)
      }
      result = await unipileService.sendLinkedInMessage(employee, message, linkedinAccountId);
      // Track message in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'MESSAGE_SENT', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          messageContent: message,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null
        });
      } catch (trackErr) {
      }
    } else if (stepType === 'linkedin_follow') {
      result = await unipileService.followLinkedInProfile(employee, linkedinAccountId);
      // Track follow in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'PROFILE_FOLLOWED', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null
        });
      } catch (trackErr) {
      }
    } else if (stepType === 'linkedin_visit') {
      // Validate inputs before making API call
      if (!linkedinUrl) {
        result = { success: false, error: 'LinkedIn URL is required' };
        return result;
      }
      if (!linkedinAccountId) {
        result = { success: false, error: 'LinkedIn account ID is required' };
        return result;
      }
      // Check if Unipile service is configured
      if (!unipileService.isConfigured()) {
        result = { success: false, error: 'Unipile service is not configured' };
        return result;
      }
      // Use Unipile profile lookup as a real "visit" and to hydrate contact info
      try {
        const startTime = Date.now();
        const profileResult = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
        const duration = Date.now() - startTime;
        // Check if account credentials expired or requires user intervention
        if (profileResult && (profileResult.accountExpired || profileResult.statusCode === 401)) {
          // Try to get another active account
          const allAccounts = await getAllLinkedInAccountsForTenant(tenantId, userId);
          const otherAccount = allAccounts.find(acc => acc.unipile_account_id !== linkedinAccountId);
          if (otherAccount && otherAccount.unipile_account_id) {
            const retryResult = await unipileService.getLinkedInContactDetails(linkedinUrl, otherAccount.unipile_account_id);
            if (retryResult && retryResult.success !== false) {
              result = {
                success: true,
                message: 'Profile visited via Unipile and contact details fetched',
                profile: retryResult.profile || retryResult
              };
              const profileData = retryResult.profile || retryResult;
              await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
            } else {
              result = {
                success: false,
                error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
                accountExpired: true
              };
            }
          } else {
            result = {
              success: false,
              error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings → LinkedIn Integration.',
              accountExpired: true
            };
          }
        } else if (profileResult && profileResult.transientError) {
          // Handle transient errors - these are temporary and should be retried
          result = {
            success: false,
            error: profileResult.error || 'Temporary connection issue. Campaign will retry.',
            transientError: true,
            userAction: 'Campaign will automatically retry this step'
          };
        } else if (profileResult && profileResult.success !== false) {
          result = {
            success: true,
            message: 'Profile visited via Unipile and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          // After successfully visiting profile, generate summary automatically
          const profileData = profileResult.profile || profileResult;
          await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
        } else {
          result = {
            success: false,
            error: profileResult?.error || 'Failed to fetch LinkedIn profile via Unipile'
          };
        }
      } catch (visitErr) {
        result = { success: false, error: visitErr.message || 'LinkedIn visit failed' };
      }
      // Track profile visit in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'PROFILE_VISITED', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null
        });
      } catch (trackErr) {
      }
    } else {
      // For other LinkedIn steps (scrape_profile, company_search, employee_list, autopost, comment_reply)
      result = { success: true, message: `LinkedIn step ${stepType} recorded` };
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}
module.exports = {
  executeLinkedInStep
};