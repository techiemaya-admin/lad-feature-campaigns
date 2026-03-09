/**
 * Lead Generation Service
 * Handles lead generation with daily limits and offset tracking
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { searchEmployees, searchEmployeesFromDatabase } = require('./LeadSearchService');
const UnipileApolloAdapterService = require('../../apollo-leads/services/UnipileApolloAdapterService');
const logger = require('../../../core/utils/logger');
const CampaignRepository = require('../repositories/CampaignRepository');
const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');
const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');

// TODO: ARCHITECTURE EXCEPTION - Direct cross-feature import
// This creates tight coupling between campaigns and apollo-leads features.
// RECOMMENDATION: Refactor to HTTP API endpoint (e.g., POST /api/apollo-leads/bulk-enrich)
// to maintain proper microservice boundaries. Current implementation kept for
// performance reasons (enrichment is time-sensitive and needs low latency).
// Estimated refactoring effort: 4-6 hours
let ApolloRevealService;
try {
  const ApolloRevealServiceClass = require('../../apollo-leads/services/ApolloRevealService');
  const apiKey = process.env.APOLLO_API_KEY;
  const baseUrl = process.env.APOLLO_BASE_URL || 'https://api.apollo.io/v1';
  ApolloRevealService = new ApolloRevealServiceClass(apiKey, baseUrl);
} catch (err) {
  logger.warn('[LeadGeneration] ApolloRevealService not available - enrichment disabled', { error: err.message });
}

/**
 * Get tenant-aware schema with proper fallback
 * For background processes without req, resolve schema from tenant context
 * @param {Object} req - Request object (optional)
 * @param {string} tenantId - Tenant ID for fallback resolution
 * @returns {string} Schema name
 */
function getTenantSchema(req, tenantId) {
  // Try to get schema from request first
  if (req) {
    return getSchema(req);
  }

  // In background processes, use environment default but log tenant context
  // This ensures we never silently use wrong schema
  const schema = getSchema(null);

  logger.info('[LeadGeneration] Schema resolved for background process', {
    schema,
    tenantId,
    source: 'environment_default'
  });

  return schema;
}
/**
 * Get list of apollo_person_ids already used by this tenant across all campaigns
 * This prevents sending duplicate leads to the same user
 * @param {string} tenantId - Tenant ID
 * @param {Object} req - Request object (optional)
 * @returns {Set<string>} Set of already-used apollo_person_ids
 */
async function getExistingLeadIds(tenantId, req = null) {
  // Use repository method for data access (LAD architecture compliance)
  return await CampaignLeadRepository.getExistingLeadIdsByTenant(tenantId, req);
}
const {
  updateCampaignConfig,
  updateStepConfig
} = require('./LeadGenerationHelpers');
const { saveLeadsToCampaign } = require('./LeadSaveService');
const { createLeadGenerationActivity } = require('./CampaignActivityService');
const CampaignModel = require('../models/CampaignModel');

/**
 * Select leads with company diversity - one lead per company
 * Ensures daily campaign targets different companies for better outreach
 * @param {Array} employees - List of employees
 * @param {number} limit - Maximum leads to select
 * @returns {Array} Diverse leads (one per company)
 */
function selectLeadsWithCompanyDiversity(employees, limit) {
  if (!employees || employees.length === 0) return [];

  const selectedLeads = [];
  const usedCompanyIds = new Set();
  const usedCompanyDomains = new Set();

  // First pass: Select one lead per unique company
  for (const employee of employees) {
    if (selectedLeads.length >= limit) break;

    // Get company identifier (prefer company_id, fallback to domain)
    const companyId = employee.company_id || employee.organization?.id;
    const companyDomain = employee.company_domain || employee.organization?.primary_domain;
    const companyName = employee.company_name || employee.organization?.name;

    // Check if we already have someone from this company
    let isDuplicate = false;

    if (companyId && usedCompanyIds.has(companyId)) {
      isDuplicate = true;
    } else if (companyDomain && usedCompanyDomains.has(companyDomain.toLowerCase())) {
      isDuplicate = true;
    }

    if (!isDuplicate) {
      selectedLeads.push(employee);
      if (companyId) usedCompanyIds.add(companyId);
      if (companyDomain) usedCompanyDomains.add(companyDomain.toLowerCase());
    }
  }

  logger.info('[executeLeadGeneration] Company diversity selection', {
    totalEmployees: employees.length,
    selectedLeads: selectedLeads.length,
    uniqueCompanies: usedCompanyDomains.size,
    limit
  });

  return selectedLeads;
}

/**
 * Execute lead generation step with daily limit support
 * @param {string} campaignId - Campaign ID
 * @param {Object} step - Step object
 * @param {Object} stepConfig - Step configuration
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @param {string} authToken - Optional JWT token for API authentication
 */
async function executeLeadGeneration(campaignId, step, stepConfig, userId, tenantId, authToken = null) {
  try {
    // Ensure stepConfig is parsed if it's a string
    if (typeof stepConfig === 'string') {
      stepConfig = JSON.parse(stepConfig);
    }

    // ROUTE: If source is 'linkedin_search', use Unipile directly (NOT Apollo)
    if (stepConfig.source === 'linkedin_search') {
      logger.info('[executeLeadGeneration] LinkedIn Search source detected — routing to Unipile', {
        campaignId, tenantId
      });
      return await executeLinkedInSearchLeadGeneration(campaignId, step, stepConfig, userId, tenantId, authToken);
    }

    // LAD Architecture: Use tenant-aware schema resolution for background processes
    const schema = getTenantSchema(null, tenantId);

    // Get campaign to access config (leads_per_day, lead_gen_offset)
    // Use repository method for data access (LAD architecture compliance)
    let campaignConfig = await CampaignRepository.getConfigById(campaignId, tenantId, null);
    let configColumnExists = campaignConfig !== null;

    if (!campaignConfig) {
      campaignConfig = {};
    }
    // If config column doesn't exist, try to read from step config
    if (!configColumnExists && stepConfig) {
      if (stepConfig.lead_gen_offset !== undefined) {
        campaignConfig.lead_gen_offset = stepConfig.lead_gen_offset;
      }
      if (stepConfig.last_lead_gen_date) {
        campaignConfig.last_lead_gen_date = stepConfig.last_lead_gen_date;
      }
    }
    // Get daily limit from campaign config or step config
    // This is the USER-SELECTED value (e.g., 25, 50, 100, etc.) - NOT hardcoded
    // Priority: 
    // 1. Step config leadGenerationLimit (if set and > 0) - allows per-step overrides
    // 2. Campaign config leads_per_day (default for all steps)
    // 3. Step config leads_per_day (legacy)
    // 4. Default 50
    const stepLimit = stepConfig.leadGenerationLimit;
    const hasValidStepLimit = stepLimit && !isNaN(stepLimit) && stepLimit > 0;

    const leadsPerDay = hasValidStepLimit
      ? stepLimit
      : (campaignConfig.leads_per_day || stepConfig.leads_per_day || 50);

    if (!leadsPerDay || leadsPerDay <= 0) {
      return { success: false, error: 'leads_per_day must be set and greater than 0' };
    }

    const configSource = hasValidStepLimit ? 'step limit'
      : campaignConfig.leads_per_day ? 'campaign config'
        : stepConfig.leads_per_day ? 'step config'
          : 'default';
    // Get current offset (how many leads have been processed so far)
    let currentOffset = campaignConfig.lead_gen_offset || stepConfig.lead_gen_offset || 0;
    // Check today's date to see if we need to process leads for today
    const today = new Date().toISOString().split('T')[0];
    const lastLeadGenDate = campaignConfig.last_lead_gen_date;

    logger.info('[executeLeadGeneration] Date check', {
      campaignId,
      today,
      lastLeadGenDate,
      isToday: lastLeadGenDate === today,
      currentOffset,
      leadsPerDay
    });

    // CRITICAL: If leads were already generated today, skip generation
    // This prevents duplicate lead generation when the server restarts
    if (lastLeadGenDate === today) {
      logger.warn('[executeLeadGeneration] Skipping - leads already generated today', {
        campaignId,
        today,
        lastLeadGenDate
      });
      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        dailyLimit: leadsPerDay,
        currentOffset: currentOffset,
        source: 'skipped',
        message: `Leads already generated today (${today})`
      };
    }
    // If it's a new day, we process leads starting from current offset
    // Offset tracks total leads processed across all days
    // CRITICAL: Get existing lead IDs to prevent duplicate leads across days/campaigns
    // This ensures we never send the same lead twice to a user
    const existingLeadIds = await getExistingLeadIds(tenantId, null);
    // Parse lead generation config
    let filters = {};

    // Accept both leadGenerationFilters and filters field names for flexibility
    if (stepConfig.leadGenerationFilters) {
      if (typeof stepConfig.leadGenerationFilters === 'string') {
        try {
          filters = JSON.parse(stepConfig.leadGenerationFilters);
          logger.info('[executeLeadGeneration] Parsed filters from string', {
            campaignId,
            originalString: stepConfig.leadGenerationFilters,
            parsedFilters: filters
          });
        } catch (e) {
          logger.error('[executeLeadGeneration] Failed to parse leadGenerationFilters', {
            campaignId,
            error: e.message,
            filterValue: stepConfig.leadGenerationFilters
          });
          filters = {};
        }
      } else if (typeof stepConfig.leadGenerationFilters === 'object') {
        filters = stepConfig.leadGenerationFilters;
      }
    } else if (stepConfig.filters) {
      // Also accept stepConfig.filters as alternative field name
      if (typeof stepConfig.filters === 'string') {
        try {
          filters = JSON.parse(stepConfig.filters);
          logger.info('[executeLeadGeneration] Parsed filters from string (filters field)', {
            campaignId,
            originalString: stepConfig.filters,
            parsedFilters: filters
          });
        } catch (e) {
          logger.error('[executeLeadGeneration] Failed to parse filters', {
            campaignId,
            error: e.message,
            filterValue: stepConfig.filters
          });
          filters = {};
        }
      } else if (typeof stepConfig.filters === 'object') {
        filters = stepConfig.filters;
      }
    }

    logger.info('[executeLeadGeneration] Filter detection', {
      campaignId,
      hasFilters: !!stepConfig.leadGenerationFilters,
      filtersType: typeof stepConfig.leadGenerationFilters,
      filtersKeys: Object.keys(filters),
      filtersContent: filters,
      fullStepConfig: stepConfig,
      stepConfigKeys: Object.keys(stepConfig)
    });

    // NORMALIZE: LinkedIn Search format → standard format
    // LinkedIn Search sends: { keywords, job_titles, locations, industries }
    // Standard format expects: { roles, location, industries }
    if (filters.job_titles && !filters.roles) {
      filters.roles = Array.isArray(filters.job_titles) ? filters.job_titles : [filters.job_titles];
      logger.info('[executeLeadGeneration] Normalized job_titles → roles', { roles: filters.roles });
    }
    if (filters.locations && !filters.location) {
      filters.location = Array.isArray(filters.locations) ? filters.locations : [filters.locations];
      logger.info('[executeLeadGeneration] Normalized locations → location', { location: filters.location });
    }
    if (filters.keywords && !filters.roles && !filters.person_titles) {
      // Use keywords as fallback for roles/title search
      filters.roles = [filters.keywords];
      logger.info('[executeLeadGeneration] Using keywords as roles fallback', { roles: filters.roles });
    }

    // GUARD: Check if at least one search criterion is provided
    // Support multiple formats:
    // 1. Old UI format in filters: roles, industries, location
    // 2. Apollo format in filters: person_titles, organization_industries, organization_locations
    // 3. Apollo format directly in stepConfig: q_organization_keyword_tags, organization_num_employees_ranges

    // Check old format in filters object
    const hasOldRoles = filters.roles && Array.isArray(filters.roles) && filters.roles.length > 0;
    const hasOldLocation = filters.location && (
      (typeof filters.location === 'string' && filters.location.trim().length > 0) ||
      (Array.isArray(filters.location) && filters.location.length > 0)
    );
    const hasOldIndustries = filters.industries && Array.isArray(filters.industries) && filters.industries.length > 0;

    // Check Apollo format in filters object
    const hasRoles = filters.person_titles && filters.person_titles.length > 0;
    const hasLocation = filters.organization_locations && filters.organization_locations.length > 0;
    const hasIndustries = filters.organization_industries && filters.organization_industries.length > 0;

    // Check for Apollo API format filters directly in stepConfig
    const hasApolloKeywords = stepConfig.q_organization_keyword_tags && stepConfig.q_organization_keyword_tags.length > 0;
    const hasApolloEmployeeRanges = stepConfig.organization_num_employees_ranges && stepConfig.organization_num_employees_ranges.length > 0;
    const hasApolloTitles = stepConfig.person_titles && stepConfig.person_titles.length > 0;
    const hasApolloLocations = stepConfig.organization_locations && stepConfig.organization_locations.length > 0;
    const hasApolloIndustries = stepConfig.organization_industries && stepConfig.organization_industries.length > 0;

    if (!hasOldRoles && !hasOldLocation && !hasOldIndustries && !hasRoles && !hasLocation && !hasIndustries && !hasApolloKeywords && !hasApolloEmployeeRanges && !hasApolloTitles && !hasApolloLocations && !hasApolloIndustries) {
      return {
        success: false,
        error: 'Lead generation filter not configured. Please set at least one of: roles, location, or industries',
        leadsFound: 0,
        leadsSaved: 0,
        source: 'skipped',
        campaignId
      };
    }
    // We always fetch 100 results from database/Apollo for efficiency
    // But only process the USER-SELECTED number (leadsPerDay) per day
    const fetchLimit = 100; // Always fetch 100 results (we cache the rest for next days)
    let dailyLimit = leadsPerDay; // Process exactly this many per day (USER-SELECTED value)

    // Override dailyLimit with default_daily_limit from social_linkedin_accounts if it's less
    // This ensures we respect account-level rate limits
    // Override dailyLimit with total daily limit from social_linkedin_accounts if it's less
    // This ensures we respect the aggregate capacity of all connected accounts
    try {
      const repository = new LinkedInAccountRepository(pool);
      const totalTenantLimit = await repository.getTotalDailyLimitForTenant(tenantId);
      const consumedCount = await repository.getTodayConnectionCount(tenantId);

      const realDailyCapacity = Math.max(0, totalTenantLimit - consumedCount);

      if (totalTenantLimit > 0 && realDailyCapacity < dailyLimit) {
        logger.info('[executeLeadGeneration] Overriding dailyLimit with remaining capacity', {
          campaignId,
          tenantId,
          userSelectedLimit: dailyLimit,
          totalLimit: totalTenantLimit,
          consumed: consumedCount,
          remaining: realDailyCapacity
        });
        dailyLimit = realDailyCapacity;
      }
    } catch (limiterr) {
      logger.warn('[executeLeadGeneration] Failed to fetch total daily limit, using user-selected limit', {
        error: limiterr.message,
        campaignId,
        tenantId,
        userSelectedLimit: dailyLimit
      });
    }

    // Calculate which page and offset within that page we need
    // Example: offset 0 = page 1, items 0-24 (25 leads)
    // Example: offset 25 = page 1, items 25-49 (25 leads)
    // Example: offset 100 = page 2, items 0-24 (25 leads)
    const page = Math.floor(currentOffset / fetchLimit) + 1;
    const offsetInPage = currentOffset % fetchLimit;
    // Build search params - always fetch 100 results
    const searchParams = {
      per_page: fetchLimit,
      page: page,
      // IMPORTANT: this flag tells /search-employees-from-db to NOT
      // run leadsService + Unipile batch connection logic. Campaign
      // lead generation manages its own leads & connections.
      disable_leads_sync: true
    };
    // Add configured filters to search params (validated above - at least one exists)
    // Priority: old format → Apollo format in filters → Apollo format in stepConfig

    // Handle person_titles/roles
    if (hasOldRoles) {
      searchParams.person_titles = Array.isArray(filters.roles) ? filters.roles : [filters.roles];
    } else if (hasRoles) {
      searchParams.person_titles = Array.isArray(filters.person_titles) ? filters.person_titles : [filters.person_titles];
    } else if (hasApolloTitles) {
      searchParams.person_titles = stepConfig.person_titles;
    }

    // Handle organization_locations/location
    if (hasOldLocation) {
      if (typeof filters.location === 'string') {
        searchParams.organization_locations = [filters.location];
      } else if (Array.isArray(filters.location)) {
        searchParams.organization_locations = filters.location;
      }
    } else if (hasLocation) {
      searchParams.organization_locations = Array.isArray(filters.organization_locations) ? filters.organization_locations : [filters.organization_locations];
    } else if (hasApolloLocations) {
      searchParams.organization_locations = stepConfig.organization_locations;
    }

    // Handle organization_industries/industries
    if (hasOldIndustries) {
      searchParams.organization_industries = Array.isArray(filters.industries) ? filters.industries : [filters.industries];
    } else if (hasIndustries) {
      searchParams.organization_industries = Array.isArray(filters.organization_industries) ? filters.organization_industries : [filters.organization_industries];
    } else if (hasApolloIndustries) {
      searchParams.organization_industries = stepConfig.organization_industries;
    }

    // Map Apollo API specific filters to expected format
    // q_organization_keyword_tags should be mapped to organization_industries
    if (hasApolloKeywords && !searchParams.organization_industries) {
      searchParams.organization_industries = stepConfig.q_organization_keyword_tags;
    }
    // organization_num_employees_ranges can be passed as is (already in correct format)
    if (hasApolloEmployeeRanges) {
      searchParams.organization_num_employees_ranges = stepConfig.organization_num_employees_ranges;
    }

    if (tenantId) {
      searchParams.tenant_id = tenantId;
    }
    if (userId) {
      searchParams.user_id = userId;
    }
    // Pass exclude list to search service (for database/Apollo queries that support it)
    if (existingLeadIds.size > 0) {
      searchParams.exclude_ids = Array.from(existingLeadIds);
    }

    // PRODUCTION-GRADE: Check search source preference (Unipile, Apollo, or Auto)
    // Get campaign configuration for source preference
    // Use repository method for data access (LAD architecture compliance)
    const campaign = await CampaignRepository.getSearchSourceById(campaignId, tenantId, null);
    const searchSource = campaign?.search_source || process.env.SEARCH_SOURCE_DEFAULT || 'apollo_io';
    const unipileAccountId = campaign?.config?.unipile_account_id || process.env.UNIPILE_ACCOUNT_ID;

    let employees = [];
    let fromSource = 'unknown';
    let searchError = null;
    let accessDenied = false;

    logger.info('[executeLeadGeneration] Starting lead search', {
      searchParams,
      searchSource,
      campaignId,
      tenantId,
      dailyLimit
    });

    try {
      // OPTION 1: Try Unipile first (if configured and requested)
      if ((searchSource === 'unipile' || searchSource === 'auto') && unipileAccountId) {
        try {
          const unipileResult = await UnipileApolloAdapterService.searchLeadsWithFallback(
            {
              keywords: searchParams.keywords,
              industry: searchParams.organization_industries?.[0],
              location: searchParams.organization_locations?.[0],
              designation: searchParams.person_titles?.[0],
              company: searchParams.company,
              skills: searchParams.skills,
              limit: dailyLimit,
              offset: offsetInPage,
              accountId: unipileAccountId
            },
            tenantId,
            authToken
          );
          if (unipileResult.success && unipileResult.people && unipileResult.people.length > 0) {
            employees = unipileResult.people.slice(0, dailyLimit);
            fromSource = unipileResult.source; // 'unipile' or 'apollo' (if fallback used)
          } else if (searchSource === 'auto') {
            // Auto mode: fallback to Apollo if Unipile failed or returned no results
            searchError = null; // Clear error to continue to Apollo
          } else {
            // Unipile was required but failed
            searchError = unipileResult.error || 'Unipile search returned no results';
          }
        } catch (unipileErr) {
          if (searchSource === 'auto') {
            searchError = null;
          } else {
            searchError = unipileErr.message;
          }
        }
      }
      // OPTION 2: Use Apollo/Database (if no Unipile, or as fallback)
      if (employees.length < dailyLimit && (searchSource === 'apollo_io' || searchSource === 'auto')) {
        // First, try to get leads from database (employees_cache)
        const dbSearchResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit - employees.length, authToken, tenantId);
        const dbEmployees = dbSearchResult.employees || [];
        if (dbEmployees.length > 0) {
          employees = [...employees, ...dbEmployees].slice(0, dailyLimit);
          fromSource = employees.length > 0 && fromSource === 'unknown' ? 'database' : (fromSource !== 'unknown' ? 'mixed' : 'database');
        }
        searchError = dbSearchResult.error || null;
        accessDenied = dbSearchResult.accessDenied || false;
        if (accessDenied) {
        }
        // If still have insufficient leads, try Apollo API
        if (employees.length < dailyLimit && !searchError && !accessDenied) {
          const neededFromApollo = dailyLimit - employees.length;

          const apolloSearchResult = await searchEmployees(searchParams, page, offsetInPage, neededFromApollo, authToken, tenantId);
          const apolloEmployees = apolloSearchResult.employees || [];
          // Combine database leads with Apollo leads
          if (apolloEmployees.length > 0) {
            employees = [...employees, ...apolloEmployees].slice(0, dailyLimit);
            fromSource = employees.length > 0 && apolloEmployees.length > 0 ? 'mixed' : (apolloEmployees.length > 0 ? 'apollo' : 'database');
          } else {
            searchError = apolloSearchResult.error || null;
          }
        }
      }
    } catch (searchErr) {
      logger.error('[executeLeadGeneration] Search execution failed', {
        error: searchErr.message,
        stack: searchErr.stack,
        searchParams,
        campaignId,
        tenantId,
        searchSource
      });
      searchError = searchErr.message;
    }
    // CRITICAL: Filter out any leads that already exist in the tenant's campaigns
    // This is a safety check in case the search service couldn't exclude them at query level
    let filteredOut = 0; // Initialize outside the if block
    if (employees.length > 0 && existingLeadIds.size > 0) {
      const originalCount = employees.length;
      employees = employees.filter(emp => {
        const empId = emp.id || emp.apollo_person_id;
        return empId && !existingLeadIds.has(empId);
      });
      filteredOut = originalCount - employees.length;
      if (filteredOut > 0) {
        logger.info('[executeLeadGeneration] Filtered duplicates', {
          campaignId,
          originalCount,
          filteredOut,
          remaining: employees.length
        });
      }
    }

    // NEW: If all leads are duplicates, fetch next page from Apollo
    // Keep fetching until we have enough unique leads or run out of results
    let currentPage = page;
    const maxPagesToFetch = 10; // Safety limit: don't fetch more than 10 pages

    while (employees.length < dailyLimit && currentPage < (page + maxPagesToFetch) && !searchError && !accessDenied) {
      logger.info('[executeLeadGeneration] Fetching next page due to duplicate filtering or insufficient leads on previous page', {
        campaignId,
        currentPage: currentPage + 1,
        neededLeads: dailyLimit - employees.length
      });

      // Fetch next page (next 100 results)
      currentPage++;

      try {
        let nextPageEmployees = [];

        if (searchSource === 'unipile' && unipileAccountId) {
          const unipileNextResult = await UnipileApolloAdapterService.searchLeadsWithFallback(
            {
              keywords: searchParams.keywords,
              industry: searchParams.organization_industries?.[0],
              location: searchParams.organization_locations?.[0],
              designation: searchParams.person_titles?.[0],
              company: searchParams.company,
              skills: searchParams.skills,
              limit: 100,
              offset: (currentPage - 1) * 100,
              accountId: unipileAccountId
            },
            tenantId,
            authToken
          );
          nextPageEmployees = unipileNextResult.people || [];
        } else {
          const nextPageResult = await searchEmployees(searchParams, currentPage, 0, 100, authToken, tenantId);
          nextPageEmployees = nextPageResult.employees || [];
        }

        if (nextPageEmployees.length === 0) {
          logger.info('[executeLeadGeneration] No more results available from Apollo', {
            campaignId,
            currentPage
          });
          break; // No more results
        }

        // Filter duplicates from next page
        const uniqueFromNextPage = nextPageEmployees.filter(emp => {
          const empId = emp.id || emp.apollo_person_id;
          return empId && !existingLeadIds.has(empId);
        });

        logger.info('[executeLeadGeneration] Next page results', {
          campaignId,
          page: currentPage,
          totalResults: nextPageEmployees.length,
          uniqueResults: uniqueFromNextPage.length,
          duplicatesFiltered: nextPageEmployees.length - uniqueFromNextPage.length
        });

        // Add unique leads from next page
        employees = [...employees, ...uniqueFromNextPage].slice(0, dailyLimit);

        // Update offset to reflect we moved to next page
        if (employees.length >= dailyLimit) {
          // We have enough leads now
          currentOffset = (currentPage - 1) * 100 + employees.length;
          break;
        }
      } catch (nextPageErr) {
        logger.error('[executeLeadGeneration] Error fetching next page', {
          error: nextPageErr.message,
          page: currentPage
        });
        break; // Stop trying
      }
    }

    // Log final results after pagination
    if (currentPage > page) {
      logger.info('[executeLeadGeneration] Pagination complete', {
        campaignId,
        startPage: page,
        endPage: currentPage,
        totalPagesChecked: currentPage - page + 1,
        finalLeadCount: employees.length,
        dailyLimit: dailyLimit
      });
    }

    // Handle access denied (403) - this is NOT an error, just no access to Apollo/database
    if (accessDenied) {
      // Set execution state to waiting_for_leads with clear message
      const now = new Date();
      const retryIntervalHours = process.env.LEAD_RETRY_INTERVAL_HOURS || 6;
      const nextRetryTime = new Date(now.getTime() + (retryIntervalHours * 60 * 60 * 1000));
      await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
        lastLeadCheckAt: now.toISOString(),
        nextRunAt: nextRetryTime.toISOString(),
        lastExecutionReason: 'Apollo Leads feature access required. Please upgrade your plan to enable lead generation.'
      });
      // Return success but with 0 leads
      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        source: 'access_denied',
        message: 'Apollo Leads feature access required for lead generation'
      };
    }
    // Handle actual errors (not access denied)
    if (searchError) {
      // Set execution state to error
      await CampaignModel.updateExecutionState(campaignId, 'error', {
        lastExecutionReason: `Lead search failed: ${searchError}`
      });
      // Return error so caller knows what happened
      return {
        success: false,
        error: `Lead search failed: ${searchError}`,
        leadsFound: 0,
        leadsSaved: 0,
        source: 'error'
      };
    }
    // PRODUCTION-GRADE: Handle no leads found scenario
    if (!employees || employees.length === 0) {
      // Set execution state to waiting_for_leads
      const now = new Date();
      const retryIntervalHours = process.env.LEAD_RETRY_INTERVAL_HOURS || 6; // Default 6 hours
      const nextRetryTime = new Date(now.getTime() + (retryIntervalHours * 60 * 60 * 1000));
      // Also check if there's a configured daily retry time (e.g., 09:00)
      const dailyRetryHour = process.env.LEAD_DAILY_RETRY_HOUR || 9; // Default 9 AM
      const dailyRetryMinute = process.env.LEAD_DAILY_RETRY_MINUTE || 0;
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(parseInt(dailyRetryHour), parseInt(dailyRetryMinute), 0, 0);
      // Use whichever is earlier: 6 hours from now, or tomorrow at configured time
      const nextRunAt = tomorrow < nextRetryTime ? tomorrow : nextRetryTime;
      await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
        lastLeadCheckAt: now.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
        lastExecutionReason: `No leads found. Retrying in ${retryIntervalHours}h or tomorrow at ${dailyRetryHour}:${dailyRetryMinute.toString().padStart(2, '0')}`
      });
      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        dailyLimit: dailyLimit,
        currentOffset: currentOffset,
        source: fromSource,
        executionState: 'waiting_for_leads',
        message: 'No leads found. Campaign will retry later.'
      };
    }
    const employeesList = employees || [];

    logger.info('[executeLeadGeneration] Leads found from search', {
      campaignId,
      employeesCount: employeesList.length,
      dailyLimit,
      fromSource
    });

    // STEP 1.5: Apply company diversity - select one lead per company
    // This ensures daily campaigns target different companies for better outreach
    const diverseEmployees = selectLeadsWithCompanyDiversity(employeesList, dailyLimit);

    // STEP 2: Automatic enrichment of search results
    // Apollo search returns obfuscated data (no emails, no LinkedIn URLs)
    // We must enrich each lead to get full contact details
    let enrichedEmployees = diverseEmployees;
    let enrichmentStats = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0
    };

    if (ApolloRevealService && fromSource !== 'database' && diverseEmployees.length > 0) {
      logger.info('[executeLeadGeneration] Starting automatic enrichment', {
        campaignId,
        leadsToEnrich: diverseEmployees.length,
        source: fromSource
      });

      enrichedEmployees = [];

      for (const employee of diverseEmployees) {
        const personId = employee.id || employee.apollo_person_id;

        // Skip if already has email (already enriched)
        if (employee.email || employee.personal_emails?.[0]) {
          enrichmentStats.skipped++;
          enrichedEmployees.push(employee);
          continue;
        }

        // Skip if no person ID
        if (!personId) {
          logger.warn('[executeLeadGeneration] No person ID for enrichment', { employee });
          enrichmentStats.skipped++;
          enrichedEmployees.push(employee);
          continue;
        }

        enrichmentStats.attempted++;

        try {
          // Call enrichment API (costs credits: 2 for email, 10 for phone)
          // Use enrichPersonDetails which returns full person data including name
          // Pass tenant context for credit deduction
          const mockReq = tenantId ? { tenant: { id: tenantId } } : null;
          const enrichResult = await ApolloRevealService.enrichPersonDetails(personId, mockReq, {
            campaignId: campaignId,
            stepType: 'lead_generation'
          });

          if (enrichResult.success && enrichResult.person) {
            // Merge enriched data with search data - capture ALL Apollo fields
            const enrichedEmployee = {
              ...employee,
              // Full name (not obfuscated)
              name: enrichResult.person.name || employee.name,
              first_name: enrichResult.person.first_name || employee.first_name,
              last_name: enrichResult.person.last_name || employee.last_name,
              // Contact details
              email: enrichResult.person.email || enrichResult.person.personal_emails?.[0],
              personal_emails: enrichResult.person.personal_emails || [],
              linkedin_url: enrichResult.person.linkedin_url || employee.linkedin_url,
              // Phone details - capture all phone numbers and sanitized phone
              phone: enrichResult.person.phone || enrichResult.person.sanitized_phone || employee.phone,
              sanitized_phone: enrichResult.person.sanitized_phone,
              phone_numbers: enrichResult.person.phone_numbers || employee.phone_numbers || [],
              // Professional details
              title: enrichResult.person.title || employee.title,
              headline: enrichResult.person.headline || employee.headline,
              photo_url: enrichResult.person.photo_url || employee.photo_url,
              // Career information
              employment_history: enrichResult.person.employment_history || employee.employment_history,
              education: enrichResult.person.education || employee.education,
              // Organization details - merge full organization object
              organization: enrichResult.person.organization || employee.organization,
              company_name: enrichResult.person.organization?.name || employee.company_name,
              company_id: enrichResult.person.organization?.id || employee.company_id,
              company_domain: enrichResult.person.organization?.domain || employee.company_domain,
              // Additional Apollo fields
              seniority: enrichResult.person.seniority || employee.seniority,
              departments: enrichResult.person.departments || employee.departments,
              functions: enrichResult.person.functions || employee.functions,
              // Store the complete enriched person data from Apollo
              _enriched_data: enrichResult.person,
              // Mark as enriched
              is_enriched: true,
              enriched_at: new Date().toISOString()
            };

            enrichedEmployees.push(enrichedEmployee);
            enrichmentStats.succeeded++;

            logger.debug('[executeLeadGeneration] Enriched lead', {
              personId,
              hasEmail: !!enrichedEmployee.email,
              hasLinkedIn: !!enrichedEmployee.linkedin_url
            });
          } else {
            // Enrichment failed but keep the search result
            enrichmentStats.failed++;
            enrichedEmployees.push({
              ...employee,
              is_enriched: false,
              enrichment_error: enrichResult.error || 'Enrichment failed'
            });

            logger.warn('[executeLeadGeneration] Enrichment failed for lead', {
              personId,
              error: enrichResult.error
            });
          }
        } catch (enrichError) {
          // Keep the search result even if enrichment crashes
          enrichmentStats.failed++;
          enrichedEmployees.push({
            ...employee,
            is_enriched: false,
            enrichment_error: enrichError.message
          });

          logger.error('[executeLeadGeneration] Enrichment exception for lead', {
            personId,
            error: enrichError.message,
            stack: enrichError.stack
          });
        }

        // Rate limiting: small delay between enrichment calls to avoid API throttling
        // Configurable via environment variable (default: 200ms)
        if (enrichmentStats.attempted < diverseEmployees.length) {
          const enrichmentDelayMs = parseInt(process.env.APOLLO_ENRICHMENT_DELAY_MS || '200', 10);
          await new Promise(resolve => setTimeout(resolve, enrichmentDelayMs));
        }
      }

      logger.info('[executeLeadGeneration] Enrichment completed', {
        campaignId,
        stats: enrichmentStats,
        finalLeadsCount: enrichedEmployees.length
      });
    } else if (!ApolloRevealService) {
      logger.warn('[executeLeadGeneration] Enrichment skipped - ApolloRevealService not available');
    }

    logger.info('[executeLeadGeneration] Preparing to save leads', {
      campaignId,
      employeesCount: enrichedEmployees.length,
      dailyLimit,
      fromSource,
      enrichmentStats
    });

    // Verify tenant_id from campaign matches the provided tenantId
    // Use repository method for data access (LAD architecture compliance)
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    // Double-check campaign exists in this tenant
    const isValidTenant = await CampaignRepository.verifyTenantOwnership(campaignId, tenantId, null);
    if (!isValidTenant) {
      throw new Error(`Campaign ${campaignId} not found for tenant ${tenantId}`);
    }

    // Determine platform from campaign steps
    const CampaignStepModel = require('../models/CampaignStepModel');
    let platform = 'apollo_io'; // default
    try {
      const steps = await CampaignStepModel.getStepsByCampaignId(campaignId, tenantId, null);
      if (steps && steps.length > 0) {
        // Find first non-lead_generation step to determine platform
        const platformStep = steps.find(s => s.type !== 'lead_generation');
        if (platformStep) {
          // Extract platform from step type (e.g., 'linkedin_connect' -> 'linkedin')
          const stepType = platformStep.type || '';
          if (stepType.startsWith('linkedin')) platform = 'linkedin';
          else if (stepType.startsWith('email')) platform = 'email';
          else if (stepType.startsWith('whatsapp')) platform = 'whatsapp';
          else if (stepType.startsWith('voice')) platform = 'voice';
          else if (stepType.startsWith('instagram')) platform = 'instagram';
        }
      }
    } catch (stepErr) {
      logger.warn('[executeLeadGeneration] Failed to determine platform from steps, using default', {
        error: stepErr.message
      });
    }

    logger.info('[executeLeadGeneration] Calling saveLeadsToCampaign', {
      campaignId,
      tenantId,
      leadsCount: diverseEmployees.length,
      platform
    });

    // Save enriched leads to campaign_leads table (only the daily limit)
    const { savedCount, firstGeneratedLeadId, skippedCount, skippedReasons } = await saveLeadsToCampaign(
      campaignId,
      tenantId,
      enrichedEmployees,
      platform
    );

    logger.info('[executeLeadGeneration] Leads saved', {
      campaignId,
      totalProcessed: enrichedEmployees.length,
      saved: savedCount,
      skipped: skippedCount,
      skippedBreakdown: skippedReasons,
      firstGeneratedLeadId
    });

    // Update campaign config with new offset and date
    // If we fetched from multiple pages, update offset to reflect the last page position
    let newOffset;
    if (currentPage > page) {
      // We paginated to next pages - calculate offset based on last page
      newOffset = (currentPage - 1) * 100 + savedCount;
      logger.info('[executeLeadGeneration] Updated offset after pagination', {
        campaignId,
        oldOffset: currentOffset,
        newOffset: newOffset,
        pagesChecked: currentPage - page + 1
      });
    } else {
      // Single page - normal offset increment
      newOffset = currentOffset + savedCount;
    }
    const updatedConfig = {
      ...campaignConfig,
      leads_per_day: leadsPerDay,
      lead_gen_offset: newOffset,
      last_lead_gen_date: today
    };
    // Try to update config column (may not exist in all schemas)
    try {
      await updateCampaignConfig(campaignId, updatedConfig, null, tenantId);
    } catch (updateError) {
      // If config column doesn't exist, store offset in step config as fallback
      try {
        // Update step config with offset and date
        const updatedStepConfig = {
          ...stepConfig,
          lead_gen_offset: newOffset,
          last_lead_gen_date: today,
          leads_per_day: leadsPerDay
        };
        await updateStepConfig(step.id, updatedStepConfig, null, tenantId);
      } catch (stepUpdateErr) {
      }
      // Also update campaign updated_at timestamp
      // Use repository method for data access (LAD architecture compliance)
      await CampaignRepository.touchUpdatedAt(campaignId, tenantId, null);
    }
    // PRODUCTION-GRADE: Handle daily limit and execution state
    // IMPORTANT: Don't set to sleep here - let the campaign processor handle it AFTER processing existing leads
    // This ensures all leads are processed through workflow steps before sleeping
    const dailyLeadsGenerated = savedCount;
    if (dailyLeadsGenerated >= dailyLimit) {
      // Daily limit reached - but DON'T set to sleep yet
      // The campaign processor will set to sleep AFTER processing existing leads
      // Set a flag in the return value so processor knows to sleep after processing
      // But keep state as 'active' for now so workflow steps can execute
    } else {
      // Leads found but not at limit - set to active
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        lastExecutionReason: `Leads found (${dailyLeadsGenerated}/${dailyLimit}). Campaign active.`
      });
    }
    // Create activity record for lead generation step (if leads were saved and we have a lead ID)
    // This allows the analytics to track lead generation executions
    if (savedCount > 0 && firstGeneratedLeadId && step) {
      try {
        // Get tenant_id and campaign_id from the lead
        // Use repository method for data access (LAD architecture compliance)
        const leadInfo = await CampaignLeadRepository.getLeadInfoById(firstGeneratedLeadId, null);
        if (leadInfo && leadInfo.tenant_id && leadInfo.campaign_id) {
          await createLeadGenerationActivity(leadInfo.tenant_id, leadInfo.campaign_id, firstGeneratedLeadId, step.id);
        }
      } catch (activityErr) {
        // Don't fail the whole process if activity creation fails
      }
    }

    // Comprehensive end-to-end summary log
    logger.info('[executeLeadGeneration] FINAL SUMMARY', {
      campaignId,
      pipelineStage: 'Lead Generation',
      totalImported: diverseEmployees.length,
      validationStats: {
        imported: diverseEmployees.length,
        enrichmentAttempted: enrichmentStats.attempted,
        enrichmentSucceeded: enrichmentStats.succeeded,
        enrichmentFailed: enrichmentStats.failed,
        enrichmentSkipped: enrichmentStats.skipped
      },
      savingStats: {
        totalProcessed: enrichedEmployees.length,
        saved: savedCount,
        skipped: skippedCount || 0,
        skippedReasons: skippedReasons || {}
      },
      dailyProgress: {
        target: dailyLimit,
        achieved: dailyLeadsGenerated,
        limitReached: dailyLeadsGenerated >= dailyLimit
      },
      nextState: dailyLeadsGenerated >= dailyLimit ? 'sleeping_until_next_day' : 'active',
      offset: {
        previous: currentOffset,
        updated: newOffset
      }
    });

    return {
      success: true,
      leadsFound: diverseEmployees.length,
      leadsSaved: savedCount,
      leadsEnriched: enrichmentStats.succeeded,
      enrichmentStats: enrichmentStats,
      dailyLimit: dailyLimit,
      currentOffset: newOffset,
      source: fromSource,
      executionState: dailyLeadsGenerated >= dailyLimit ? 'sleeping_until_next_day' : 'active',
      dailyLimitReached: dailyLeadsGenerated >= dailyLimit // Flag to indicate limit was reached
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Execute lead generation using Unipile LinkedIn Search (NOT Apollo)
 * This is the dedicated lead generation function for Advanced Search campaigns.
 * 
 * Pipeline:
 * 1. Get LinkedIn account ID for the tenant
 * 2. Resolve location names → LinkedIn location IDs (via Unipile parameters API)
 * 3. Resolve industry names → LinkedIn industry IDs (via Unipile parameters API)
 * 4. Execute LinkedIn people search (via Unipile search API)
 * 5. Filter out existing leads (no duplicates)
 * 6. Save new leads to campaign_leads table
 *
 * @param {string} campaignId
 * @param {Object} step
 * @param {Object} stepConfig - Contains { source, leadGenerationFilters, leadGenerationLimit }
 * @param {string} userId
 * @param {string} tenantId
 * @param {string} authToken
 */
async function executeLinkedInSearchLeadGeneration(campaignId, step, stepConfig, userId, tenantId, authToken = null) {
  const LinkedInSearchService = require('./LinkedInSearchService');
  const linkedInSearch = new LinkedInSearchService();

  try {
    const schema = getTenantSchema(null, tenantId);

    // Get campaign config for offset/date tracking
    let campaignConfig = await CampaignRepository.getConfigById(campaignId, tenantId, null);
    if (!campaignConfig) campaignConfig = {};

    // Daily limit from step config or campaign config
    let dailyLimit = stepConfig.leadGenerationLimit || campaignConfig.leads_per_day || 10;

    try {
      // Enforce the tenant's total connected limits
      const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
      const repo = new LinkedInAccountRepository(require('../../../shared/database/connection').pool);
      const tenantMaxLimit = await repo.getTotalDailyLimitForTenant(tenantId);
      if (tenantMaxLimit > 0 && dailyLimit > tenantMaxLimit) {
        logger.info(`[LinkedInSearchLeadGen] Capping daily limit from ${dailyLimit} to tenant max limit ${tenantMaxLimit}`);
        dailyLimit = tenantMaxLimit;
      }
    } catch (err) {
      logger.warn('[LinkedInSearchLeadGen] Failed to fetch tenant limit for capping', { error: err.message });
    }

    // Check if leads already generated today
    const today = new Date().toISOString().split('T')[0];
    const lastLeadGenDate = campaignConfig.last_lead_gen_date;

    if (lastLeadGenDate === today) {
      logger.info('[LinkedInSearchLeadGen] Skipping — leads already generated today', { campaignId, today });
      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        source: 'linkedin_search_skipped',
        message: `LinkedIn search leads already generated today (${today})`
      };
    }

    // Parse filters from step config
    const filters = stepConfig.leadGenerationFilters || {};
    const keywords = filters.keywords || '';
    const locations = filters.locations || [];
    const industries = filters.industries || [];
    const jobTitles = filters.job_titles || [];
    const profileLanguage = filters.profile_language || [];

    logger.info('[LinkedInSearchLeadGen] Starting Unipile LinkedIn search', {
      campaignId, tenantId, keywords, locations, industries, jobTitles, dailyLimit
    });

    // Step 1: Get LinkedIn account ID. Use Sales Navigator by default for advanced search.
    const accountId = process.env.SALES_NAVIGATOR_PROVIDER_ID;
    if (!accountId) {
      logger.error('[LinkedInSearchLeadGen] No Sales Navigator account configured.');
      await CampaignModel.updateExecutionState(campaignId, 'error', {
        lastExecutionReason: 'Sales Navigator provider ID not configured for advanced search.'
      });
      return {
        success: false,
        error: 'Sales Navigator provider ID not configured.',
        leadsFound: 0,
        leadsSaved: 0,
        source: 'linkedin_search'
      };
    }

    logger.info('[LinkedInSearchLeadGen] LinkedIn account resolved', { accountId, tenantId });

    // Step 2: Resolve location names → LinkedIn location IDs
    const locationIds = [];
    for (const loc of locations) {
      if (!loc || loc.trim() === '') continue;
      try {
        const resolved = await linkedInSearch.resolveParameterIds('LOCATION', loc, accountId);
        if (resolved.length > 0) {
          locationIds.push(resolved[0].id);
          logger.info('[LinkedInSearchLeadGen] Location resolved', { location: loc, id: resolved[0].id, name: resolved[0].name });
        }
      } catch (locErr) {
        logger.warn('[LinkedInSearchLeadGen] Failed to resolve location', { location: loc, error: locErr.message });
      }
    }

    // Step 3: Resolve industry names → LinkedIn industry IDs
    const industryIds = [];
    for (const ind of industries) {
      if (!ind || ind.trim() === '') continue;
      try {
        const resolved = await linkedInSearch.resolveParameterIds('INDUSTRY', ind, accountId);
        if (resolved.length > 0) {
          industryIds.push(resolved[0].id);
          logger.info('[LinkedInSearchLeadGen] Industry resolved', { industry: ind, id: resolved[0].id });
        }
      } catch (indErr) {
        logger.warn('[LinkedInSearchLeadGen] Failed to resolve industry', { industry: ind, error: indErr.message });
      }
    }

    // Retrieve saved cursor if any
    let searchCursor = stepConfig.searchCursor || campaignConfig.searchCursor || null;

    logger.info('[LinkedInSearchLeadGen] Executing Unipile search loop', { accountId, dailyLimit, startingCursor: searchCursor });

    let finalNewLeads = [];
    let _newCursor = searchCursor;
    let iteration = 0;
    const MAX_ITERATIONS = 5; // Safety fallback to prevent infinite loops

    const existingLeadIds = await getExistingLeadIds(tenantId, null);

    while (finalNewLeads.length < dailyLimit && iteration < MAX_ITERATIONS) {
      iteration++;
      const currentSearchParams = {
        isSalesNav: true,
        keywords: keywords || (jobTitles.length > 0 ? jobTitles[0] : ''),
        location_ids: locationIds,
        industry_ids: industryIds,
        profile_language: profileLanguage,
        title: jobTitles.length > 0 ? jobTitles[0] : undefined,
        cursor: _newCursor
      };

      logger.info(`[LinkedInSearchLeadGen] Search iteration ${iteration}`, { currentSearchParams });

      let searchResult;
      try {
        searchResult = await linkedInSearch.searchPeople(currentSearchParams, accountId);
      } catch (searchErr) {
        logger.error('[LinkedInSearchLeadGen] Unipile search failed during loop', { error: searchErr.message, campaignId });
        if (finalNewLeads.length === 0) {
          // If we got NO leads at all, fail out
          await CampaignModel.updateExecutionState(campaignId, 'error', {
            lastExecutionReason: `LinkedIn search failed on iteration ${iteration}: ${searchErr.message}`
          });
          return {
            success: false,
            error: `LinkedIn search failed: ${searchErr.message}`,
            leadsFound: 0,
            leadsSaved: 0,
            source: 'linkedin_search'
          };
        } else {
          // We got some leads previously, so just stop here and process what we have
          break;
        }
      }

      const results = searchResult.results || [];
      _newCursor = searchResult.cursor || null;

      logger.info(`[LinkedInSearchLeadGen] Search loop returned results`, {
        iteration, resultsCount: results.length, total: searchResult.total, nextCursor: _newCursor
      });

      if (results.length === 0) {
        break; // No more results returned
      }

      // Filter duplicates for this batch
      let uniqueInBatch = results;
      if (existingLeadIds.size > 0) {
        uniqueInBatch = results.filter(lead => {
          const leadId = lead.provider_id || lead.id;
          return leadId && !existingLeadIds.has(leadId);
        });
      }

      // Avoid adding exact same leads if multiple pages somehow return overlapping data
      const currentFinalIds = new Set(finalNewLeads.map(l => l.provider_id || l.id));
      uniqueInBatch = uniqueInBatch.filter(lead => !currentFinalIds.has(lead.provider_id || lead.id));

      finalNewLeads = [...finalNewLeads, ...uniqueInBatch];

      logger.info(`[LinkedInSearchLeadGen] Unique batch results`, {
        iteration, uniqueInBatch: uniqueInBatch.length, totalAccumulated: finalNewLeads.length, required: dailyLimit
      });

      if (!_newCursor) {
        break; // Search pool exhausted on API side
      }
    }

    if (finalNewLeads.length === 0 && !_newCursor) {
      // No more results and no cursor means we've completely exhausted the search pool!
      logger.info('[LinkedInSearchLeadGen] Search pool exhausted. Completing campaign.', { campaignId });

      await CampaignModel.updateExecutionState(campaignId, 'completed', {
        lastLeadCheckAt: new Date().toISOString(),
        lastExecutionReason: `Campaign completed. All matching leads exhausted.`
      });

      // Also update overall status
      const schema = getTenantSchema(null, tenantId);
      await require('../../../shared/database/connection').pool.query(
        `UPDATE ${schema}.campaigns SET status = 'completed' WHERE id = $1`,
        [campaignId]
      );

      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        source: 'linkedin_search',
        message: 'No more LinkedIn profiles found. Campaign automatically completed.'
      };
    } else if (finalNewLeads.length === 0) {
      // We didn't find any unique leads, but there IS a cursor. This is rare but could happen if a full page was dupes.
      // Let's set it to waiting so it can retry with the new cursor later
      const retryIntervalHours = process.env.LEAD_RETRY_INTERVAL_HOURS || 6;
      const nextRetryTime = new Date(Date.now() + (retryIntervalHours * 60 * 60 * 1000));

      const schema = getTenantSchema(null, tenantId);
      // We must save the cursor so it resumes from here on retry
      const updatedConfig = { ...campaignConfig, searchCursor: _newCursor };
      await require('../../../shared/database/connection').pool.query(
        `UPDATE ${schema}.campaigns SET config = $1 WHERE id = $2`,
        [JSON.stringify(updatedConfig), campaignId]
      );

      await CampaignModel.updateExecutionState(campaignId, 'waiting_for_leads', {
        lastLeadCheckAt: new Date().toISOString(),
        nextRunAt: nextRetryTime.toISOString(),
        lastExecutionReason: `No new unique profiles found on this page. Retrying next page in ${retryIntervalHours}h.`
      });

      return {
        success: true,
        leadsFound: 0,
        leadsSaved: 0,
        source: 'linkedin_search',
        message: 'No new unique LinkedIn profiles found. Will check next page shortly.'
      };
    }

    // Limit precisely to daily limit
    const leadsToSave = finalNewLeads.slice(0, dailyLimit);

    // Step 6: Save leads using the existing LeadSaveService pipeline
    const { saveLeadsToCampaign } = require('./LeadSaveService');

    const employeesForSave = leadsToSave.map(lead => {
      const raw = lead._raw || {};
      return {
        id: lead.provider_id || lead.id || '',
        provider_id: lead.provider_id || lead.id || '',
        public_identifier: lead.public_identifier || raw.public_identifier || '',
        member_urn: lead.member_urn || raw.member_urn || '',
        name: lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        first_name: lead.first_name || raw.first_name || '',
        last_name: lead.last_name || raw.last_name || '',
        title: lead.headline || raw.headline || raw.title || '',
        headline: lead.headline || raw.headline || '',
        email: lead.email || raw.email || null,
        phone: lead.phone || raw.phone || null,
        linkedin_url: lead.profile_url || raw.public_profile_url || raw.profile_url || '',
        profile_url: lead.profile_url || '',
        company_name: lead.current_company || raw.current_company || raw.company || '',
        photo_url: lead.profile_picture || raw.profile_picture_url || raw.profile_picture || '',
        city: lead.location || raw.location || '',
        country: raw.country || '',
        industry: lead.industry || raw.industry || '',
        network_distance: lead.network_distance || raw.network_distance || null,
        premium: lead.premium || raw.premium || false,
        summary: lead.summary || raw.summary || '',
        _source: 'linkedin_search',
        _raw_unipile: raw
      };
    });

    let savedCount = 0;
    try {
      const saveResult = await saveLeadsToCampaign(campaignId, tenantId, employeesForSave, 'linkedin_search');
      savedCount = saveResult.savedCount || 0;
      logger.info('[LinkedInSearchLeadGen] Leads saved via LeadSaveService', {
        campaignId, savedCount, skipped: saveResult.skippedCount || 0
      });
    } catch (saveErr) {
      logger.error('[LinkedInSearchLeadGen] LeadSaveService failed', {
        campaignId, error: saveErr.message
      });
    }

    // Check if campaign duration has ended
    const campaignDays = campaignConfig.campaign_days || 30;
    const startDate = new Date(campaignConfig.campaign_start_date || campaignConfig.created_at);
    const currentDate = new Date();
    const daysElapsed = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));

    let nextExecutionState = savedCount >= dailyLimit ? 'sleeping_until_next_day' : 'active';
    let isCompleted = false;

    if (daysElapsed >= campaignDays) {
      logger.info('[LinkedInSearchLeadGen] Campaign duration elapsed. Completing campaign.', { campaignId, campaignDays, daysElapsed });
      nextExecutionState = 'completed';
      isCompleted = true;

      const schema = getTenantSchema(null, tenantId);
      await require('../../../shared/database/connection').pool.query(
        `UPDATE ${schema}.campaigns SET status = 'completed' WHERE id = $1`,
        [campaignId]
      );
    }

    // Update campaign config with today's date, offset, and the NEW cursor
    const currentOffset = campaignConfig.lead_gen_offset || 0;
    const newOffset = currentOffset + savedCount;

    try {
      const updatedConfig = {
        ...campaignConfig,
        last_lead_gen_date: today,
        lead_gen_offset: newOffset,
        searchCursor: _newCursor // Store cursor for tomorrow's search
      };
      await updateCampaignConfig(campaignId, updatedConfig, null, tenantId);
    } catch (configErr) {
      logger.warn('[LinkedInSearchLeadGen] Failed to update campaign config', { error: configErr.message });
    }

    // Log activity
    try {
      await createLeadGenerationActivity(tenantId, campaignId, null, step.id || null, null);
    } catch (actErr) {
      logger.warn('[LinkedInSearchLeadGen] Failed to log activity', { error: actErr.message });
    }

    logger.info('[LinkedInSearchLeadGen] Lead generation complete', {
      campaignId, leadsFound: finalNewLeads.length, leadsNew: leadsToSave.length,
      leadsSaved: savedCount, dailyLimit, source: 'linkedin_search',
      completed: isCompleted
    });

    return {
      success: true,
      leadsFound: finalNewLeads.length,
      leadsSaved: savedCount,
      leadCount: savedCount,
      dailyLimit,
      currentOffset: newOffset,
      source: 'linkedin_search',
      executionState: nextExecutionState,
      dailyLimitReached: savedCount >= dailyLimit || isCompleted
    };

  } catch (error) {
    logger.error('[LinkedInSearchLeadGen] Failed', { campaignId, error: error.message, stack: error.stack });
    return { success: false, error: error.message, leadsFound: 0, leadsSaved: 0, source: 'linkedin_search' };
  }
}

module.exports = {
  executeLeadGeneration,
  executeLinkedInSearchLeadGeneration
};
