/**
 * Lead Generation Service
 * Handles lead generation with daily limits and offset tracking
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { searchEmployees, searchEmployeesFromDatabase } = require('./LeadSearchService');
const UnipileApolloAdapterService = require('../../apollo-leads/services/UnipileApolloAdapterService');
const logger = require('../../../core/utils/logger');
/**
 * Get list of apollo_person_ids already used by this tenant across all campaigns
 * This prevents sending duplicate leads to the same user
 * @param {string} tenantId - Tenant ID
 * @returns {Set<string>} Set of already-used apollo_person_ids
 */
async function getExistingLeadIds(tenantId) {
  try {
    const schema = getSchema();
    const result = await pool.query(
      `SELECT DISTINCT lead_data->>'apollo_person_id' as apollo_person_id,
              lead_data->>'id' as lead_id
       FROM ${schema}.campaign_leads 
       WHERE tenant_id = $1 AND is_deleted = FALSE
         AND (lead_data->>'apollo_person_id' IS NOT NULL OR lead_data->>'id' IS NOT NULL)`,
      [tenantId]
    );
    const existingIds = new Set();
    for (const row of result.rows) {
      if (row.apollo_person_id) existingIds.add(row.apollo_person_id);
      if (row.lead_id) existingIds.add(row.lead_id);
    }
    return existingIds;
  } catch (err) {
    return new Set(); // Return empty set on error - will allow duplicates but won't break
  }
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
    // LAD Architecture: Use dynamic schema resolution
    const schema = getSchema(null); // No req available in background process, will use default
    // Get campaign to access config (leads_per_day, lead_gen_offset)
    // First try to get config from campaigns table (if config column exists)
    let campaignConfig = {};
    let configColumnExists = false;
    try {
      const campaignResult = await pool.query(
        `SELECT config FROM ${schema}.campaigns WHERE id = $1 AND tenant_id = $2`,
        [campaignId, tenantId]
      );
      if (campaignResult.rows[0]?.config) {
        campaignConfig = typeof campaignResult.rows[0].config === 'string' 
          ? JSON.parse(campaignResult.rows[0].config) 
          : campaignResult.rows[0].config;
        configColumnExists = true;
      }
    } catch (err) {
      // Config column might not exist, try reading from step config instead
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
    const existingLeadIds = await getExistingLeadIds(tenantId);
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
    const campaignQuery = await pool.query(
      `SELECT config, search_source FROM ${schema}.campaigns 
       WHERE id = $1 AND is_deleted = FALSE`,
      [campaignId]
    );
    const campaign = campaignQuery.rows[0];
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
      }
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
    
    logger.info('[executeLeadGeneration] Preparing to save leads', {
      campaignId,
      employeesCount: employeesList.length,
      dailyLimit,
      fromSource
    });
    
    // Verify tenant_id from campaign matches the provided tenantId
    // Campaign data already fetched at line 254, so we have the campaign object
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    // Double-check campaign exists in this tenant
    const campaignCheckQuery = await pool.query(
      `SELECT id FROM ${schema}.campaigns WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE`,
      [campaignId, tenantId]
    );
    if (campaignCheckQuery.rows.length === 0) {
      throw new Error(`Campaign ${campaignId} not found for tenant ${tenantId}`);
    }
    
    logger.info('[executeLeadGeneration] Calling saveLeadsToCampaign', {
      campaignId,
      tenantId,
      leadsCount: employeesList.length
    });
    
    // Save leads to campaign_leads table (only the daily limit)
    const { savedCount, firstGeneratedLeadId } = await saveLeadsToCampaign(
      campaignId,
      tenantId,
      employeesList
    );
    
    logger.info('[executeLeadGeneration] Leads saved', {
      campaignId,
      savedCount,
      firstGeneratedLeadId
    });
    // Update campaign config with new offset and date
    const newOffset = currentOffset + savedCount;
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
      try {
        // Per TDD: Use lad_dev schema
        await pool.query(
          `UPDATE ${schema}.campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
          [campaignId, tenantId]
        );
      } catch (err) {
        // Ignore - not critical
      }
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
        const leadInfo = await pool.query(
          `SELECT tenant_id, campaign_id FROM ${schema}.campaign_leads WHERE id = $1`,
          [firstGeneratedLeadId]
        );
        const { tenant_id, campaign_id } = leadInfo.rows[0] || {};
        if (tenant_id && campaign_id) {
          await createLeadGenerationActivity(tenant_id, campaign_id, firstGeneratedLeadId, step.id);
        }
      } catch (activityErr) {
        // Don't fail the whole process if activity creation fails
      }
    }
    return { 
      success: true, 
      leadsFound: employeesList.length,
      leadsSaved: savedCount,
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
