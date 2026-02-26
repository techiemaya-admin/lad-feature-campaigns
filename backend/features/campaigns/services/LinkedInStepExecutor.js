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

  // LAD ARCHITECTURE FIX: Check if THIS campaign_lead was already enriched
  // Don't just check memory - check database enriched_at timestamp
  if (databaseLeadId) {
    const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');
    const { getSchema } = require('../../../core/utils/schemaHelper');
    const schema = getSchema(null);

    const enrichmentCheck = await pool.query(
      `SELECT enriched_email, enriched_linkedin_url, enriched_at
       FROM ${schema}.campaign_leads
       WHERE lead_id = $1 AND tenant_id = $2 AND is_deleted = FALSE
       ORDER BY enriched_at DESC NULLS LAST
       LIMIT 1`,
      [databaseLeadId, tenantId]
    );

    if (enrichmentCheck.rows.length > 0 && enrichmentCheck.rows[0].enriched_at) {
      const cached = enrichmentCheck.rows[0];
      logger.info('[LinkedInStepExecutor] Lead already enriched (from database), skipping', {
        leadId: databaseLeadId,
        enrichedAt: cached.enriched_at,
        hasEmail: !!cached.enriched_email,
        hasLinkedIn: !!cached.enriched_linkedin_url,
        creditsSaved: 2
      });

      // Return cached enriched data
      return {
        ...leadData,
        email: cached.enriched_email || leadData.email,
        linkedin_url: cached.enriched_linkedin_url || leadData.linkedin_url,
        already_enriched: true
      };
    }
  }

  // Check if already enriched (has both email and linkedin_url in memory)
  const hasEmail = leadData.email || leadData.personal_emails?.[0];
  const hasLinkedIn = leadData.linkedin_url || leadData.employee_linkedin_url;

  if (hasEmail && hasLinkedIn) {
    logger.info('[LinkedInStepExecutor] Lead already enriched (from memory)', {
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

    // CROSS-TENANT ENRICHMENT CACHE: Check for existing enriched data from other tenants first
    let enrichedFromCache = null;
    const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');

    const cacheSearchEmail = leadData.email || leadData.personal_emails?.[0];
    const cacheSearchName = leadData.name || `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim();
    const cacheSearchCompany = leadData.company_name;

    logger.info('[LinkedInStepExecutor] Searching for enriched leads from database', {
      searchEmail: cacheSearchEmail ? cacheSearchEmail.substring(0, 15) + '...' : null,
      searchName: cacheSearchName || null,
      searchCompany: cacheSearchCompany || null,
      currentTenantId: tenantId.substring(0, 8) + '...'
    });

    const cachedLeads = await CampaignLeadRepository.findEnrichedLeadFromOtherTenants(
      cacheSearchEmail,
      cacheSearchName,
      cacheSearchCompany,
      personId,
      tenantId
    );

    if (cachedLeads && cachedLeads.length > 0) {
      const cachedLead = cachedLeads[0];

      // Use enriched data from cross-tenant cache (already filtered for current tenant)
      enrichedFromCache = {
        email: cachedLead.enriched_email,
        linkedin_url: cachedLead.enriched_linkedin_url,
        from_cache: true,
        source_tenant_id: cachedLead.tenant_id,
        cached_at: cachedLead.enriched_at
      };

      logger.info('[LinkedInStepExecutor] Found enriched data from CROSS-TENANT CACHE (reusing)', {
        leadId: leadData.id,
        cacheEmail: cachedLead.enriched_email ? cachedLead.enriched_email.substring(0, 15) + '...' : null,
        hasLinkedInUrl: !!cachedLead.enriched_linkedin_url,
        sourceTenantId: cachedLead.tenant_id.substring(0, 8) + '...',
        enrichedDaysAgo: cachedLead.enriched_at ?
          Math.floor((Date.now() - new Date(cachedLead.enriched_at).getTime()) / (1000 * 60 * 60 * 24)) : null
      });
    } else {
      logger.info('[LinkedInStepExecutor] No enriched leads found in cross-tenant cache (CACHE MISS) - will call Apollo API', {
        leadId: leadData.id,
        searchEmail: cacheSearchEmail ? cacheSearchEmail.substring(0, 15) + '...' : null,
        searchName: cacheSearchName || null,
        searchCompany: cacheSearchCompany || null
      });
    }

    // Use cached data from cross-tenant if available, otherwise call Apollo API
    let enrichResult;
    let enrichmentSource = 'none';

    if (enrichedFromCache) {
      // Reuse enriched data from another tenant (cross-tenant cache hit)
      enrichmentSource = 'cross_tenant_cache';
      enrichResult = {
        email: enrichedFromCache.email,
        linkedin_url: enrichedFromCache.linkedin_url,
        from_cache: true,
        success: true,
        source: enrichmentSource,
        person: {
          email: enrichedFromCache.email,
          linkedin_url: enrichedFromCache.linkedin_url,
          first_name: leadData.first_name,
          last_name: leadData.last_name,
          name: leadData.name
        }
      };

      logger.info('[LinkedInStepExecutor] Using enriched data from cross-tenant cache', {
        leadId: leadData.id,
        source: enrichmentSource,
        creditsSpared: 2,
        sourceTenantId: enrichedFromCache.source_tenant_id.substring(0, 8) + '...'
      });
    } else {
      // No cross-tenant cache hit - call Apollo API to enrich
      enrichmentSource = 'apollo_api';
      const mockReq = tenantId ? { tenant: { id: tenantId } } : null;
      enrichResult = await ApolloRevealService.enrichPersonDetails(personId, mockReq, {
        campaignId: campaignId,
        leadId: databaseLeadId
      });

      if (enrichResult && enrichResult.success) {
        logger.info('[LinkedInStepExecutor] Enriched from Apollo API (cross-tenant cache miss)', {
          leadId: databaseLeadId,
          personId: personId,
          hasEmail: !!enrichResult.person?.email,
          hasLinkedIn: !!enrichResult.person?.linkedin_url,
          creditsUsed: enrichResult.credits_used || 2
        });
      }
    }

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
        revealedName: !!enrichedPerson.first_name,
        source: enrichResult.from_cache ? 'cache' : 'apollo_api'
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
            firstName: enrichedPerson.first_name,
            source: enrichResult.from_cache ? 'cache' : 'apollo_api'
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
    const linkedinAccountUserId = linkedinAccount?.user_id || userId;  // User ID from social_linkedin_accounts

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

      // Validate daily and weekly limits before sending connection request
      const dailyLimitExceeded = await checkTenantDailyLimit(tenantId, campaignLead.campaign_id);
      const weeklyLimitExceeded = await checkTenantWeeklyLimit(tenantId, campaignLead.campaign_id);

      if (dailyLimitExceeded) {
        logger.warn('[LinkedInStepExecutor] Daily connection limit reached for tenant', {
          tenantId,
          campaignId: campaignLead.campaign_id,
          stepType
        });
        return {
          success: false,
          error: 'Daily LinkedIn connection limit reached for your account. The limit will reset tomorrow.',
          userAction: 'Wait for daily limit reset'
        };
      }

      if (weeklyLimitExceeded) {
        logger.warn('[LinkedInStepExecutor] Weekly connection limit reached for tenant', {
          tenantId,
          campaignId: campaignLead.campaign_id,
          stepType
        });
        return {
          success: false,
          error: 'Weekly LinkedIn connection limit reached for your account. The limit will reset in 7 days.',
          userAction: 'Wait for weekly limit reset'
        };
      }

      // Proceed with connection request if limits are not exceeded
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
      // Differentiate between connection with message vs without message
      const actionType = result.strategy === 'with_message'
        ? 'CONNECTION_SENT_WITH_MESSAGE'
        : 'CONNECTION_SENT';

      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, actionType, {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          messageContent: result.strategy === 'with_message' ? message : null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: result.accountInfo?.account_name || result.accountUsed || null,
          providerAccountId: result.accountInfo?.provider_account_id || null,
          userId: linkedinAccountUserId,  // User ID from social_linkedin_accounts
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
            userId: linkedinAccountUserId,  // User ID from social_linkedin_accounts
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
      // Use 'CONTACTED' to indicate follow-up message after connection acceptance
      try {
        await campaignStatsTracker.trackAction(campaignLead.campaign_id, 'CONTACTED', {
          leadId: campaignLead.lead_id || campaignLead.id,
          channel: 'linkedin',
          leadName: employee.fullname,
          messageContent: message,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.error || null,
          tenantId: tenantId,
          accountName: linkedinAccountName,
          providerAccountId: linkedinAccountId,
          userId: linkedinAccountUserId,  // User ID from social_linkedin_accounts
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
          userId: linkedinAccountUserId,  // User ID from social_linkedin_accounts
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
          userId: linkedinAccountUserId,  // User ID from social_linkedin_accounts
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

/**
 * Check if tenant has exceeded daily LinkedIn connection limit
 * @param {string} tenantId - Tenant ID
 * @param {string} campaignId - Campaign ID for logging
 * @returns {Promise<boolean>} - True if daily limit exceeded, false if not exceeded
 */
async function checkTenantDailyLimit(tenantId, campaignId) {
  const logger = require('../../../core/utils/logger');
  const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');

  try {
    // Initialize repository with pool
    const repository = new LinkedInAccountRepository(pool);

    // Step 1: Get total daily limit for all LinkedIn accounts of the tenant
    const totalDailyLimit = await repository.getTotalDailyLimitForTenant(tenantId);

    logger.info('[checkTenantDailyLimit] Total daily limit calculated', {
      tenantId,
      campaignId,
      totalDailyLimit
    });

    if (totalDailyLimit <= 0) {
      logger.warn('[checkTenantDailyLimit] No connected LinkedIn accounts or zero daily limit', {
        tenantId,
        campaignId
      });
      return true; // Block if no valid accounts
    }

    // Step 2: Get today's connection count from campaign_analytics
    const todayConnectionCount = await repository.getTodayConnectionCount(tenantId);

    logger.info('[checkTenantDailyLimit] Today connection count retrieved', {
      tenantId,
      campaignId,
      totalDailyLimit,
      todayConnectionCount
    });

    // Step 3: Compare counts
    const isLimitExceeded = todayConnectionCount >= totalDailyLimit;

    logger.info('[checkTenantDailyLimit] Limit validation result', {
      tenantId,
      campaignId,
      totalDailyLimit,
      todayConnectionCount,
      isLimitExceeded,
      remainingLimit: Math.max(0, totalDailyLimit - todayConnectionCount)
    });

    return isLimitExceeded;
  } catch (err) {
    logger.error('[checkTenantDailyLimit] Error checking daily limit', {
      tenantId,
      campaignId,
      error: err.message,
      stack: err.stack
    });

    // On error, allow operation to proceed (fail open)
    // This prevents campaign execution from breaking if schema/table doesn't exist yet
    return false;
  }
}

/**
 * Check if tenant's 7-day rolling weekly limit for LinkedIn connections is exceeded
 * Compares last 7 days connection count against total weekly limit across all accounts
 * @param {string} tenantId - Tenant ID
 * @param {string} campaignId - Campaign ID (for logging)
 * @returns {Promise<boolean>} true if limit exceeded, false otherwise
 */
async function checkTenantWeeklyLimit(tenantId, campaignId) {
  const logger = require('../../../core/utils/logger');
  const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');

  try {
    // Initialize repository with pool
    const repository = new LinkedInAccountRepository(pool);

    // Step 1: Get total weekly limit for all LinkedIn accounts of the tenant
    const totalWeeklyLimit = await repository.getTotalWeeklyLimitForTenant(tenantId);

    logger.info('[checkTenantWeeklyLimit] Total weekly limit calculated', {
      tenantId,
      campaignId,
      totalWeeklyLimit
    });

    if (totalWeeklyLimit <= 0) {
      logger.debug('[checkTenantWeeklyLimit] No weekly limit set for tenant (not enforced)', {
        tenantId,
        campaignId
      });
      return false; // No weekly limit configured, allow operation
    }

    // Step 2: Get last 7 days connection count from campaign_analytics (rolling window)
    const lastSevenDaysCount = await repository.getLastSevenDaysConnectionCount(tenantId);

    logger.info('[checkTenantWeeklyLimit] Last 7 days connection count retrieved', {
      tenantId,
      campaignId,
      totalWeeklyLimit,
      lastSevenDaysCount
    });

    // Step 3: Compare counts
    const isLimitExceeded = lastSevenDaysCount >= totalWeeklyLimit;

    logger.info('[checkTenantWeeklyLimit] Weekly limit validation result', {
      tenantId,
      campaignId,
      totalWeeklyLimit,
      lastSevenDaysCount,
      isLimitExceeded,
      remainingLimit: Math.max(0, totalWeeklyLimit - lastSevenDaysCount),
      rollingWindow: '7 days'
    });

    return isLimitExceeded;
  } catch (err) {
    logger.error('[checkTenantWeeklyLimit] Error checking weekly limit', {
      tenantId,
      campaignId,
      error: err.message,
      stack: err.stack
    });

    // On error, allow operation to proceed (fail open)
    // This prevents campaign execution from breaking if schema/table doesn't exist yet
    return false;
  }
}

async function checkTenantDailyLimit(tenantId, campaignId) {
  const logger = require('../../../core/utils/logger');
  const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');

  try {
    // Initialize repository with pool
    const repository = new LinkedInAccountRepository(pool);

    // Step 1: Get total daily limit for all LinkedIn accounts of the tenant
    const totalDailyLimit = await repository.getTotalDailyLimitForTenant(tenantId);

    logger.info('[checkTenantDailyLimit] Total daily limit calculated', {
      tenantId,
      campaignId,
      totalDailyLimit
    });

    if (totalDailyLimit <= 0) {
      logger.warn('[checkTenantDailyLimit] No connected LinkedIn accounts or zero daily limit', {
        tenantId,
        campaignId
      });
      return true; // Block if no valid accounts
    }

    // Step 2: Get today's connection count from campaign_analytics
    const todayConnectionCount = await repository.getTodayConnectionCount(tenantId);

    logger.info('[checkTenantDailyLimit] Today connection count retrieved', {
      tenantId,
      campaignId,
      totalDailyLimit,
      todayConnectionCount
    });

    // Step 3: Compare counts
    const isLimitExceeded = todayConnectionCount >= totalDailyLimit;

    logger.info('[checkTenantDailyLimit] Limit validation result', {
      tenantId,
      campaignId,
      totalDailyLimit,
      todayConnectionCount,
      isLimitExceeded,
      remainingLimit: Math.max(0, totalDailyLimit - todayConnectionCount)
    });

    return isLimitExceeded;
  } catch (err) {
    logger.error('[checkTenantDailyLimit] Error checking daily limit', {
      tenantId,
      campaignId,
      error: err.message,
      stack: err.stack
    });

    // On error, allow operation to proceed (fail open)
    // This prevents campaign execution from breaking if schema/table doesn't exist yet
    return false;
  }
}

module.exports = {
  executeLinkedInStep
};
