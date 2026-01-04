/**
 * Lead Generation Service
 * Handles lead generation with daily limits and offset tracking
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { searchEmployees, searchEmployeesFromDatabase } = require('./LeadSearchService');
const {
  updateCampaignConfig,
  updateStepConfig
} = require('./LeadGenerationHelpers');
const { saveLeadsToCampaign } = require('./LeadSaveService');
const { createLeadGenerationActivity } = require('./CampaignActivityService');
const CampaignModel = require('../models/CampaignModel');
const logger = require('../../../core/utils/logger');

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
    logger.info('[Campaign Execution] Executing lead generation', { campaignId, userId, tenantId });
    
    // Ensure stepConfig is parsed if it's a string
    if (typeof stepConfig === 'string') {
      stepConfig = JSON.parse(stepConfig);
    }
    
    // Get campaign to access config (leads_per_day, lead_gen_offset)
    // First try to get config from campaigns table (if config column exists)
    let campaignConfig = {};
    let configColumnExists = false;
    try {
      // LAD Architecture: Use dynamic schema resolution
      const schema = getSchema(null); // No req available, will use default
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
      logger.debug('[Campaign Execution] Config column not available, checking step config');
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
      logger.error('[Campaign Execution] Invalid leads_per_day setting');
      return { success: false, error: 'leads_per_day must be set and greater than 0' };
    }
    
    const configSource = campaignConfig.leads_per_day ? 'campaign config' 
                        : stepConfig.leads_per_day ? 'step config' 
                        : stepConfig.leadGenerationLimit ? 'step limit'
                        : 'default';
    logger.info('[Campaign Execution] Using user-selected leads_per_day', { leadsPerDay, configSource });
    
    // Get current offset (how many leads have been processed so far)
    let currentOffset = campaignConfig.lead_gen_offset || stepConfig.lead_gen_offset || 0;
    
    // Check today's date to see if we need to process leads for today
    const today = new Date().toISOString().split('T')[0];
    const lastLeadGenDate = campaignConfig.last_lead_gen_date;
    
    // CRITICAL: If leads were already generated today, skip generation
    // This prevents duplicate lead generation when the server restarts
    if (lastLeadGenDate === today) {
      logger.info('[Campaign Execution] Leads already generated today, skipping', { today, currentOffset });
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
    logger.info('[Campaign Execution] Lead generation status', { today, lastLeadGenDate: lastLeadGenDate || 'never', currentOffset });
    
    // Parse lead generation config
    const filters = stepConfig.leadGenerationFilters 
      ? (typeof stepConfig.leadGenerationFilters === 'string' 
          ? JSON.parse(stepConfig.leadGenerationFilters) 
          : stepConfig.leadGenerationFilters)
      : {};
    
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
    
    if (filters.roles && filters.roles.length > 0) {
      searchParams.person_titles = Array.isArray(filters.roles) ? filters.roles : [filters.roles];
    }
    
    if (filters.location) {
      searchParams.organization_locations = Array.isArray(filters.location) ? filters.location : [filters.location];
    }
    
    if (filters.industries && filters.industries.length > 0) {
      searchParams.organization_industries = Array.isArray(filters.industries) ? filters.industries : [filters.industries];
    }
    
    if (tenantId) {
      searchParams.tenant_id = tenantId;
    }
    
    if (userId) {
      searchParams.user_id = userId;
    }
    
    logger.info('[Campaign Execution] Lead generation parameters', { dailyLimit, currentOffset, page, offsetInPage });
    
    // Log search parameters for debugging
    logger.debug('[Campaign Execution] Calling LeadSearchService with filters', {
      person_titles: searchParams.person_titles,
      organization_industries: searchParams.organization_industries,
      organization_locations: searchParams.organization_locations,
      page,
      offsetInPage,
      dailyLimit
    });
    
    // PRODUCTION-GRADE: Check employees_cache first, then Apollo
    // This matches how real SaaS platforms work (cache-first strategy)
    logger.debug('[Campaign Execution] STEP 1: Checking employees_cache table first');
    let employees = [];
    let fromSource = 'unknown';
    let searchError = null;
    
    let accessDenied = false;
    
    try {
      // First, try to get leads from database (employees_cache)
      const dbSearchResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken);
      employees = dbSearchResult.employees || [];
      fromSource = dbSearchResult.fromSource || 'database';
      searchError = dbSearchResult.error || null;
      accessDenied = dbSearchResult.accessDenied || false;
      
      logger.info('[Campaign Execution] Database search result', { leadCount: employees.length, source: fromSource });
      if (accessDenied) {
        logger.warn('[Campaign Execution] User does not have Apollo Leads feature access - database access denied');
      }
      
      // If no leads from database and access is NOT denied, try Apollo API
      if (employees.length === 0 && !searchError && !accessDenied) {
        logger.debug('[Campaign Execution] STEP 2: No leads in employees_cache, calling Apollo API');
        const apolloSearchResult = await searchEmployees(searchParams, page, offsetInPage, dailyLimit, authToken);
        employees = apolloSearchResult.employees || [];
        fromSource = apolloSearchResult.fromSource || 'apollo';
        searchError = apolloSearchResult.error || null;
        
        logger.info('[Campaign Execution] Apollo search result', { leadCount: employees.length, source: fromSource });
      }
    } catch (searchErr) {
      logger.error('[Campaign Execution] Lead search error', { error: searchErr.message, stack: searchErr.stack });
      searchError = searchErr.message;
    }
    
    logger.info('[Campaign Execution] Final search result', {
      employeesCount: employees.length,
      fromSource: fromSource,
      hasError: !!searchError,
      accessDenied: accessDenied,
      error: searchError || 'none'
    });
    
    // Handle access denied (403) - this is NOT an error, just no access to Apollo/database
    if (accessDenied) {
      logger.warn('[Campaign Execution] Apollo Leads feature access required for lead generation');
      logger.warn('[Campaign Execution] Campaign will continue but no leads will be generated');
      
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
      logger.error('[Campaign Execution] Lead search returned error', { 
        error: searchError,
        backendUrl: require('./LeadSearchService').BACKEND_URL || 'not set'
      });
      
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
      logger.warn('[Campaign Execution] No employees found', { 
        possibleReasons: [
          'No leads match the filters (too specific)',
          'Database is empty',
          'Network/connection issues'
        ],
        searchParams
      });
      
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
      
      logger.info('[Campaign Execution] Campaign set to waiting_for_leads state', { nextRetry: nextRunAt.toISOString() });
      
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
    
    // Get tenant_id from campaign
    const campaignQuery = await pool.query(
      `SELECT tenant_id FROM ${schema}.campaigns WHERE id = $1 AND is_deleted = FALSE`,
      [campaignId]
    );
    const tenantId = campaignQuery.rows[0]?.tenant_id;
    
    if (!tenantId) {
      throw new Error(`Campaign ${campaignId} not found or missing tenant_id`);
    }
      
    // Save leads to campaign_leads table (only the daily limit)
    const { savedCount, firstGeneratedLeadId } = await saveLeadsToCampaign(
      campaignId,
      tenantId,
      employeesList
    );
      
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
      logger.debug('[Campaign Execution] Config column not available, storing offset in step config');
      try {
        // Update step config with offset and date
        const updatedStepConfig = {
          ...stepConfig,
          lead_gen_offset: newOffset,
          last_lead_gen_date: today,
          leads_per_day: leadsPerDay
        };
        
        await updateStepConfig(step.id, updatedStepConfig, null, tenantId);
        logger.info('[Campaign Execution] Stored offset in step config', { offset: newOffset, date: today });
      } catch (stepUpdateErr) {
        logger.error('[Campaign Execution] Error storing offset in step config', { error: stepUpdateErr.message, stack: stepUpdateErr.stack });
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
    
    logger.info('[Campaign Execution] Updated campaign offset', { oldOffset: currentOffset, newOffset, savedCount, today });
    
    // PRODUCTION-GRADE: Handle daily limit and execution state
    // IMPORTANT: Don't set to sleep here - let the campaign processor handle it AFTER processing existing leads
    // This ensures all leads are processed through workflow steps before sleeping
    const dailyLeadsGenerated = savedCount;
    
    if (dailyLeadsGenerated >= dailyLimit) {
      // Daily limit reached - but DON'T set to sleep yet
      // The campaign processor will set to sleep AFTER processing existing leads
      logger.info('[Campaign Execution] Daily limit reached, will sleep after processing existing leads', { dailyLeadsGenerated, dailyLimit });
      
      // Set a flag in the return value so processor knows to sleep after processing
      // But keep state as 'active' for now so workflow steps can execute
    } else {
      // Leads found but not at limit - set to active
      await CampaignModel.updateExecutionState(campaignId, 'active', {
        lastExecutionReason: `Leads found (${dailyLeadsGenerated}/${dailyLimit}). Campaign active.`
      });
      
      logger.info('[Campaign Execution] Campaign set to active state', { dailyLeadsGenerated, dailyLimit });
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
        logger.info('[Campaign Execution] Created lead generation activity record', { savedCount });
      } catch (activityErr) {
        // Don't fail the whole process if activity creation fails
        logger.warn('[Campaign Execution] Failed to create lead generation activity', { error: activityErr.message });
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
    logger.error('[Campaign Execution] Lead generation error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

module.exports = {
  executeLeadGeneration
};

