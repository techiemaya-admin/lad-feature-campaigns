/**
 * LinkedIn Step Executor
 * Handles all LinkedIn-related step executions
 */
const unipileService = require('./unipileService');
const { getLeadData } = require('./StepExecutors');
const {
  getAllLinkedInAccountsForTenant,
  getLinkedInAccountForExecution,
  sendConnectionRequestWithFallback
} = require('./LinkedInAccountHelper');
const { generateAndSaveProfileSummary } = require('./LinkedInProfileSummaryService');
const { campaignStatsTracker } = require('./campaignStatsTracker');
const linkedInPollingRepository = require('../repositories/LinkedInPollingRepository');

// Import ApolloRevealService for data enrichment
// TODO: ARCHITECTURE EXCEPTION - Direct cross-feature import
// This creates tight coupling between campaigns and apollo-leads features.
let ApolloRevealService;
try {
  const ApolloRevealServiceClass = require('../../apollo-leads/services/ApolloRevealService');
  const { APOLLO_CONFIG } = require('../../apollo-leads/constants/constants');
  const apiKey = process.env.APOLLO_API_KEY;
  const baseUrl = APOLLO_CONFIG?.DEFAULT_BASE_URL || 'https://api.apollo.io/v1';
  ApolloRevealService = new ApolloRevealServiceClass(apiKey, baseUrl);
} catch (err) {
  // ApolloRevealService not available - enrichment will be skipped
  const logger = require('../../../core/utils/logger');
  logger.warn('[LinkedInStepExecutor] ApolloRevealService not available', { error: err.message });
}
/**
 * Enrich lead data with Apollo to reveal email and LinkedIn URL
 * @param {Object} leadData - Lead data object
 * @param {string} tenantId - Tenant ID
 * @param {string} databaseLeadId - The actual UUID lead_id from leads table (not Apollo ID)
 * @param {string} campaignId - Campaign ID for credit tracking (optional)
 * @returns {Object} Enriched lead data with email and linkedin_url
 */
async function enrichLeadForLinkedIn(leadData, tenantId, databaseLeadId = null, campaignId = null) {
  const logger = require('../../../core/utils/logger');
  
  if (!ApolloRevealService) {
    logger.warn('[LinkedInStepExecutor] ApolloRevealService not available - skipping enrichment');
    return leadData;
  }
  
  // Get Apollo person ID from lead data (for API call)
  const personId = leadData.apollo_person_id || leadData.source_id || leadData.id;
  
  if (!personId) {
    logger.warn('[LinkedInStepExecutor] No Apollo person ID found for enrichment', {
      leadId: leadData.id
    });
    return leadData;
  }
  
  // Check if already enriched (has both email and linkedin_url)
  const hasEmail = leadData.email || leadData.personal_emails?.[0];
  const hasLinkedIn = leadData.linkedin_url || leadData.employee_linkedin_url;
  
  if (hasEmail && hasLinkedIn) {
    logger.info('[LinkedInStepExecutor] Lead already enriched', {
      leadId: leadData.id,
      hasEmail: !!hasEmail,
      hasLinkedIn: !!hasLinkedIn
    });
    return leadData;
  }
  
  try {
    logger.info('[LinkedInStepExecutor] Enriching lead for LinkedIn visit', {
      leadId: leadData.id,
      personId,
      tenantId,
      needsEmail: !hasEmail,
      needsLinkedIn: !hasLinkedIn
    });
    
    // Pass tenant context for credit deduction
    const mockReq = tenantId ? { tenant: { id: tenantId } } : null;
    const enrichResult = await ApolloRevealService.enrichPersonDetails(personId, mockReq, {
      campaignId: campaignId,
      leadId: databaseLeadId
    });
    
    if (enrichResult && enrichResult.success && enrichResult.person) {
      const enrichedPerson = enrichResult.person;
      
      // Merge enriched data into leadData
      if (enrichedPerson.email && !hasEmail) {
        leadData.email = enrichedPerson.email;
      }
      if (enrichedPerson.linkedin_url && !hasLinkedIn) {
        leadData.linkedin_url = enrichedPerson.linkedin_url;
        leadData.employee_linkedin_url = enrichedPerson.linkedin_url;
      }
      if (enrichedPerson.personal_emails && enrichedPerson.personal_emails.length > 0 && !hasEmail) {
        leadData.email = enrichedPerson.personal_emails[0];
      }
      
      logger.info('[LinkedInStepExecutor] Lead enriched successfully', {
        leadId: leadData.id,
        databaseLeadId,
        revealedEmail: !!enrichedPerson.email,
        revealedLinkedIn: !!enrichedPerson.linkedin_url,
        revealedName: !!enrichedPerson.first_name
      });
      
      // Also update leadData with name from enrichment
      if (enrichedPerson.first_name) {
        leadData.first_name = enrichedPerson.first_name;
      }
      if (enrichedPerson.last_name) {
        leadData.last_name = enrichedPerson.last_name;
      }
      if (enrichedPerson.name) {
        leadData.name = enrichedPerson.name;
      }
      
      // Update lead in database with enriched data (using repository - LAD Architecture)
      // Use databaseLeadId (UUID) for the leads table, not the Apollo person ID
      if (databaseLeadId) {
        try {
          const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');
          
          await CampaignLeadRepository.updateLeadEnrichmentData(
            databaseLeadId,
            tenantId,
            {
              email: enrichedPerson.email || null,
              linkedin_url: enrichedPerson.linkedin_url || null,
              first_name: enrichedPerson.first_name || null,
              last_name: enrichedPerson.last_name || null
            }
          );
          
          logger.info('[LinkedInStepExecutor] Updated lead in database with enriched data', {
            leadId: databaseLeadId,
            firstName: enrichedPerson.first_name
          });
        } catch (updateErr) {
          logger.warn('[LinkedInStepExecutor] Failed to update lead with enriched data', {
            error: updateErr.message,
            databaseLeadId
          });
        }
      } else {
        logger.warn('[LinkedInStepExecutor] No database lead ID provided - skipping database update');
      }
    } else {
      logger.warn('[LinkedInStepExecutor] Enrichment returned no data', {
        leadId: leadData.id,
        enrichResult
      });
    }
  } catch (enrichErr) {
    logger.error('[LinkedInStepExecutor] Enrichment failed', {
      leadId: leadData.id,
      error: enrichErr.message
    });
  }
  
  return leadData;
}

/**
 * Execute LinkedIn step
 */
async function executeLinkedInStep(stepType, stepConfig, campaignLead, userId, tenantId) {
  try {
    const logger = require('../../../core/utils/logger');
    
    // Get lead data - CRITICAL: Pass tenantId for proper tenant scoping
    let leadData = await getLeadData(campaignLead.id, null, tenantId);
    
    logger.info('[LinkedInStepExecutor] Got leadData', {
      campaignLeadId: campaignLead.id,
      hasLeadData: !!leadData,
      leadDataKeys: leadData ? Object.keys(leadData) : [],
      linkedin_url: leadData?.linkedin_url,
      employee_linkedin_url: leadData?.employee_linkedin_url,
      hasEmployeeData: !!leadData?.employee_data
    });
    
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    // AUTO-ENRICHMENT: For linkedin_visit, linkedin_connect, linkedin_message steps
    // Automatically enrich lead to reveal email and LinkedIn URL if not available
    const linkedInStepsNeedingEnrichment = ['linkedin_visit', 'linkedin_connect', 'linkedin_message'];
    if (linkedInStepsNeedingEnrichment.includes(stepType)) {
      const hasLinkedIn = leadData.linkedin_url 
        || leadData.employee_linkedin_url
        || leadData.employee_data?.linkedin_url
        || leadData.employee_data?.linkedin
        || leadData.employee_data?.profile_url;
      
      if (!hasLinkedIn) {
        logger.info('[LinkedInStepExecutor] LinkedIn URL not found - triggering auto-enrichment', {
          stepType,
          campaignLeadId: campaignLead.id,
          databaseLeadId: campaignLead.lead_id,
          campaignId: campaignLead.campaign_id
        });
        // Pass the actual database lead_id (UUID) for updating the leads table
        // Also pass campaignId for credit tracking
        leadData = await enrichLeadForLinkedIn(leadData, tenantId, campaignLead.lead_id, campaignLead.campaign_id);
      }
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
    const linkedinAccount = await getLinkedInAccountForExecution(tenantId, userId);
    const linkedinAccountId = linkedinAccount?.provider_account_id || null;
    const linkedinAccountName = linkedinAccount?.account_name || 'LinkedIn Account';
    
    logger.info('[LinkedInStepExecutor] LinkedIn account check', {
      stepType,
      tenantId,
      userId,
      hasLinkedInAccountId: !!linkedinAccountId,
      linkedinAccountId,
      linkedinAccountName
    });
    
    if (!linkedinAccountId) {
      logger.warn('[LinkedInStepExecutor] No LinkedIn account found', {
        stepType,
        tenantId,
        userId,
        error: 'No active LinkedIn account connected'
      });
      return { 
        success: false, 
        error: 'No active LinkedIn account connected. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
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
      // Get campaign to read connection message from config
      const CampaignModel = require('../models/CampaignModel');
      const campaign = await CampaignModel.getById(campaignLead.campaign_id, tenantId);
      const campaignConnectionMessage = campaign?.config?.connectionMessage || null;
      
      // LinkedIn allows unlimited connection requests WITHOUT messages
      // But only 4-5 connection requests WITH messages per month
      // User can select "send with message" in UI - if limit exceeded, fallback to without message
      let message = stepConfig.message || stepConfig.connectionMessage || campaignConnectionMessage || null;
      
      // FIX: Enhanced message validation with trim
      // Clean up message - trim whitespace and convert empty strings to null
      const trimmedMessage = message && typeof message === 'string' ? message.trim() : message;
      const hasMessage = trimmedMessage && trimmedMessage !== '';
      
      // Replace message with trimmed version (or null if empty)
      message = hasMessage ? trimmedMessage : null;
      
      // User wants message if: explicitly requested OR message content exists
      const userWantsMessage = !!hasMessage;
      
      // Replace variables in message if message exists
      if (message) {
        const firstName = (leadData.name || leadData.employee_name || 'there').split(' ')[0];
        const lastName = (leadData.name || leadData.employee_name || '').split(' ').slice(1).join(' ');
        const title = leadData.title || leadData.employee_data?.title || '';
        const companyName = leadData.company_name || leadData.organization || leadData.company || leadData.employee_data?.organization?.name || '';
        const industry = leadData.employee_data?.organization?.industry || '';
        
        message = message
          .replace(/\{\{first_name\}\}/g, firstName)
          .replace(/\{\{last_name\}\}/g, lastName)
          .replace(/\{\{title\}\}/g, title)
          .replace(/\{\{company_name\}\}/g, companyName)
          .replace(/\{\{company\}\}/g, companyName)
          .replace(/\{\{industry\}\}/g, industry);
      }
      // Get all available LinkedIn accounts for fallback
      const allAccounts = await getAllLinkedInAccountsForTenant(tenantId, userId);
      // Try connection request with smart fallback logic
      // Pass tenantId for credit deduction on success
      result = await sendConnectionRequestWithFallback(
        employee,
        message,
        userWantsMessage,
        linkedinAccountId,
        allAccounts,
        { tenantId }
      );
      
      logger.info('[LinkedInStepExecutor] Connection request result', {
        stepType,
        success: result.success,
        accountUsed: result.accountUsed,
        strategy: result.strategy,
        error: result.error,
        employeeName: employee.fullname
      });
      
      // Track connection request in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'CONNECTION_SENT', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: result.accountInfo?.account_name || result.accountUsed || null,
          providerAccountId: result.accountInfo?.provider_account_id || null,
          leadLinkedIn: linkedinUrl
        });
      } catch (trackErr) {
      }
      // Add 10-second delay after sending connection request to avoid rate limiting
      // This prevents sending requests too fast and hitting LinkedIn's rate limits
      // Delay applies regardless of success/failure to maintain consistent rate
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else if (stepType === 'linkedin_message') {
      let message = stepConfig.message || stepConfig.body || 'Hello!';
      
      // Replace variables in message
      const firstName = (leadData.name || leadData.employee_name || 'there').split(' ')[0];
      const lastName = (leadData.name || leadData.employee_name || '').split(' ').slice(1).join(' ');
      const title = leadData.title || leadData.employee_data?.title || '';
      const companyName = leadData.company_name || leadData.organization || leadData.company || leadData.employee_data?.organization?.name || '';
      const industry = leadData.employee_data?.organization?.industry || '';
      
      message = message
        .replace(/\{\{first_name\}\}/g, firstName)
        .replace(/\{\{last_name\}\}/g, lastName)
        .replace(/\{\{title\}\}/g, title)
        .replace(/\{\{company_name\}\}/g, companyName)
        .replace(/\{\{company\}\}/g, companyName)
        .replace(/\{\{industry\}\}/g, industry);
      
      // ✅ Check if connection was accepted before sending message
      // Get the lead_id from campaign_leads (the actual lead UUID, not campaign_lead ID)
      let actualLeadId = campaignLead.lead_id || campaignLead.id;
      
      try {
        logger.info('[LinkedInStepExecutor] Checking connection acceptance', {
          stepType,
          campaignId: campaignLead.campaign_id,
          leadId: actualLeadId
        });
        
        // Call repository to check connection status (repository handles SQL)
        const isConnectionAccepted = await linkedInPollingRepository.isConnectionAccepted(
          campaignLead.campaign_id,
          actualLeadId,
          { user: { tenant_id: tenantId } }
        );
          
        if (!isConnectionAccepted) {
          logger.info('[LinkedInStepExecutor] Connection not accepted yet - skipping message', {
            campaignId: campaignLead.campaign_id,
            leadId: actualLeadId
          });
          
          // Track as skipped (not failed, just waiting for acceptance)
          await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'MESSAGE_SKIPPED', {
            leadId: actualLeadId,
            channel: 'linkedin',
            leadName: employee.fullname,
            messageContent: message,
            status: 'skipped',
            errorMessage: 'Waiting for connection acceptance',
            tenantId: tenantId,
            accountName: linkedinAccountName,
            providerAccountId: linkedinAccountId,
            leadLinkedIn: linkedinUrl
          });
          
          return {
            success: false,
            error: 'Connection not accepted yet - message will be sent after acceptance',
            skipped: true
          };
        }
        
        logger.info('[LinkedInStepExecutor] Connection accepted - proceeding with message', {
          campaignId: campaignLead.campaign_id,
          leadId: actualLeadId
        });
      } catch (checkErr) {
        // Log the error but continue anyway (backward compatibility)
        logger.warn('[LinkedInStepExecutor] Error checking connection acceptance - continuing anyway', {
          error: checkErr.message,
          campaignId: campaignLead.campaign_id,
          leadId: actualLeadId
        });
      }
      result = await unipileService.sendLinkedInMessage(employee, message, linkedinAccountId, { tenantId });
      // Track message in campaign_analytics for Live Activity Feed
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'MESSAGE_SENT', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          messageContent: message,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: linkedinAccountName,
          providerAccountId: linkedinAccountId,
          leadLinkedIn: linkedinUrl
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
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: linkedinAccountName,
          providerAccountId: linkedinAccountId,
          leadLinkedIn: linkedinUrl
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
      // Check if LinkedIn service is configured
      if (!unipileService.isConfigured()) {
        result = { success: false, error: 'LinkedIn service is not configured' };
        return result;
      }
      
      logger.info('[LinkedInStepExecutor] Executing linkedin_visit step', {
        linkedinUrl,
        linkedinAccountId,
        employeeName: employee.fullname
      });
      
      // Use Unipile profile lookup as a real "visit" and to hydrate contact info
      try {
        const startTime = Date.now();
        const profileResult = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
        const duration = Date.now() - startTime;
        
        logger.info('[LinkedInStepExecutor] linkedin_visit profile result', {
          success: profileResult?.success !== false,
          accountExpired: profileResult?.accountExpired,
          hasProfile: !!profileResult?.profile,
          duration
        });
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
                message: 'Profile visited and contact details fetched',
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
            message: 'Profile visited and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          // After successfully visiting profile, generate summary automatically
          const profileData = profileResult.profile || profileResult;
          await generateAndSaveProfileSummary(campaignLead.id, leadData, profileData, employee);
        } else {
          result = {
            success: false,
            error: profileResult?.error || 'Failed to fetch LinkedIn profile'
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
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: linkedinAccountName,
          providerAccountId: linkedinAccountId,
          leadLinkedIn: linkedinUrl
        });
      } catch (trackErr) {
      }
    } else {
      // For other LinkedIn steps (scrape_profile, company_search, employee_list, autopost, comment_reply)
      result = { success: true, message: `LinkedIn step ${stepType} recorded` };
    }
    return result;
  } catch (error) {
    const logger = require('../../../core/utils/logger');
    logger.error('[LinkedInStepExecutor] executeLinkedInStep failed', {
      stepType,
      error: error.message,
      stack: error.stack,
      campaignLeadId: campaignLead?.id
    });
    return { success: false, error: error.message };
  }
}
module.exports = {
  executeLinkedInStep
};
