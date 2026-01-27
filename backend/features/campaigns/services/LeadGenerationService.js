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

// TODO: ARCHITECTURE EXCEPTION - Direct cross-feature import
// This creates tight coupling between campaigns and apollo-leads features.
// RECOMMENDATION: Refactor to HTTP API endpoint (e.g., POST /api/apollo-leads/bulk-enrich)
// to maintain proper microservice boundaries. Current implementation kept for
// performance reasons (enrichment is time-sensitive and needs low latency).
// Estimated refactoring effort: 4-6 hours
let ApolloRevealService;
try {
  const ApolloRevealServiceClass = require('../../apollo-leads/services/ApolloRevealService');
  ApolloRevealService = new ApolloRevealServiceClass();
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
    // Priority: campaign config > step config > step limit > default 50
    const leadsPerDay = campaignConfig.leads_per_day || stepConfig.leads_per_day || stepConfig.leadGenerationLimit || 50;
    if (!leadsPerDay || leadsPerDay <= 0) {
      return { success: false, error: 'leads_per_day must be set and greater than 0' };
    }
    const configSource = campaignConfig.leads_per_day ? 'campaign config' 
                        : stepConfig.leads_per_day ? 'step config' 
                        : stepConfig.leadGenerationLimit ? 'step limit'
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
    const dailyLimit = leadsPerDay; // Process exactly this many per day (USER-SELECTED value)
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
    if (employees.length > 0 && existingLeadIds.size > 0) {
      const originalCount = employees.length;
      employees = employees.filter(emp => {
        const empId = emp.id || emp.apollo_person_id;
        return empId && !existingLeadIds.has(empId);
      });
      const filteredOut = originalCount - employees.length;
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
      // Only continue if we got results but they were all duplicates
      if (filteredOut === 0 || currentPage === page) {
        // Either no duplicates were filtered, or this is the first page - don't fetch more
        break;
      }
      
      logger.info('[executeLeadGeneration] All leads were duplicates, fetching next page', {
        campaignId,
        currentPage: currentPage + 1,
        neededLeads: dailyLimit - employees.length
      });
      
      // Fetch next page (next 100 results)
      currentPage++;
      
      try {
        const nextPageResult = await searchEmployees(searchParams, currentPage, 0, 100, authToken, tenantId);
        const nextPageEmployees = nextPageResult.employees || [];
        
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

    // STEP 2: Automatic enrichment of search results
    // Apollo search returns obfuscated data (no emails, no LinkedIn URLs)
    // We must enrich each lead to get full contact details
    let enrichedEmployees = employeesList;
    let enrichmentStats = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0
    };

    if (ApolloRevealService && fromSource !== 'database' && employeesList.length > 0) {
      logger.info('[executeLeadGeneration] Starting automatic enrichment', {
        campaignId,
        leadsToEnrich: employeesList.length,
        source: fromSource
      });

      enrichedEmployees = [];
      
      for (const employee of employeesList) {
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
          // Call enrichment API (costs credits: 1 for email, 8 for phone)
          const enrichResult = await ApolloRevealService.revealPersonEmail(personId);
          
          if (enrichResult.success && enrichResult.person) {
            // Merge enriched data with search data
            const enrichedEmployee = {
              ...employee,
              // Full name (not obfuscated)
              name: enrichResult.person.name || employee.name,
              first_name: enrichResult.person.first_name || employee.first_name,
              last_name: enrichResult.person.last_name || employee.last_name,
              // Contact details
              email: enrichResult.person.email || enrichResult.person.personal_emails?.[0],
              personal_emails: enrichResult.person.personal_emails || [],
              linkedin_url: enrichResult.person.linkedin_url,
              // Employment history
              employment_history: enrichResult.person.employment_history || employee.employment_history,
              // Phone (if available)
              phone_numbers: enrichResult.person.phone_numbers || employee.phone_numbers,
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
        if (enrichmentStats.attempted < employeesList.length) {
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
    
    logger.info('[executeLeadGeneration] Calling saveLeadsToCampaign', {
      campaignId,
      tenantId,
      leadsCount: employeesList.length
    });
    
    // Save enriched leads to campaign_leads table (only the daily limit)
    const { savedCount, firstGeneratedLeadId } = await saveLeadsToCampaign(
      campaignId,
      tenantId,
      enrichedEmployees
    );
    
    logger.info('[executeLeadGeneration] Leads saved', {
      campaignId,
      savedCount,
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
    return { 
      success: true, 
      leadsFound: employeesList.length,
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
module.exports = {
  executeLeadGeneration
};
