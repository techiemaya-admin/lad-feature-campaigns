const { pool } = require('../../../shared/database/connection');
const axios = require('axios');
const unipileService = require('./unipileService');
const { generateProfileSummary } = require('../../../shared/services/profileSummary');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3004';

/**
 * Get required fields for each step type (matches frontend validation)
 */
function getRequiredFieldsForStepType(stepType) {
  const requiredFields = {
    linkedin_connect: [], // Message is optional due to LinkedIn's 4-5 connection messages/month limit
    linkedin_message: ['message'],
    email_send: ['subject', 'body'],
    email_followup: ['subject', 'body'],
    whatsapp_send: ['whatsappMessage'],
    voice_agent_call: ['voiceAgentId', 'voiceContext'], // voiceContext maps to added_context (required by API)
    instagram_dm: ['instagramUsername', 'instagramDmMessage'],
    delay: ['delayDays', 'delayHours'], // At least one time unit must be > 0
    condition: ['conditionType'],
    linkedin_scrape_profile: ['linkedinScrapeFields'],
    linkedin_company_search: ['linkedinCompanyName'],
    linkedin_employee_list: ['linkedinCompanyUrl'],
    linkedin_autopost: ['linkedinPostContent'],
    linkedin_comment_reply: ['linkedinCommentText'],
    instagram_follow: ['instagramUsername'],
    instagram_like: ['instagramPostUrl'],
    instagram_autopost: ['instagramPostCaption', 'instagramPostImageUrl'],
    instagram_comment_reply: ['instagramCommentText'],
    instagram_story_view: ['instagramUsername'],
    lead_generation: [], // Handled specially - uses leadGenerationFilters
    // No required fields for these
    linkedin_visit: [],
    linkedin_follow: [],
    start: [],
    end: [],
  };
  
  return requiredFields[stepType] || [];
}

/**
 * Check if a field value is valid (not empty, null, or undefined)
 */
function isFieldValid(fieldValue) {
  if (fieldValue === undefined || fieldValue === null) return false;
  if (typeof fieldValue === 'string' && fieldValue.trim() === '') return false;
  if (Array.isArray(fieldValue) && fieldValue.length === 0) return false;
  if (typeof fieldValue === 'number' && isNaN(fieldValue)) return false;
  return true;
}

/**
 * Validate delay step - at least one time unit must be > 0
 */
function isDelayValid(stepConfig) {
  const days = parseInt(stepConfig.delayDays || stepConfig.delay_days || 0);
  const hours = parseInt(stepConfig.delayHours || stepConfig.delay_hours || 0);
  const minutes = parseInt(stepConfig.delayMinutes || stepConfig.delay_minutes || 0);
  return days > 0 || hours > 0 || minutes > 0;
}

/**
 * Validate step configuration - check if all required fields are filled
 */
function validateStepConfig(stepType, stepConfig) {
  let requiredFields = getRequiredFieldsForStepType(stepType);
  const missingFields = [];
  const invalidFields = [];
  
  // Special validation for delay step
  if (stepType === 'delay') {
    if (!isDelayValid(stepConfig)) {
      return {
        valid: false,
        error: 'Delay step requires at least one time unit (days, hours, or minutes) to be greater than 0',
        missingFields: ['delayDays', 'delayHours']
      };
    }
    // Delay validation passed, skip field checks
    return { valid: true };
  }
  
  // Special handling for lead_generation - uses leadGenerationFilters and leads_per_day from campaign config
  if (stepType === 'lead_generation') {
    // Parse filters if it's a string
    let filters = stepConfig.leadGenerationFilters;
    if (filters && typeof filters === 'string') {
      try {
        filters = JSON.parse(filters);
      } catch (e) {
        // Invalid JSON, treat as empty
        filters = {};
      }
    }
    
    // Check if filters object has at least one valid field (roles, industries, or location)
    let hasValidFilters = false;
    const missingFilterFields = [];
    
    if (filters && typeof filters === 'object') {
      // Check for roles (array of strings)
      if (filters.roles && Array.isArray(filters.roles) && filters.roles.length > 0) {
        const validRoles = filters.roles.filter(r => r && typeof r === 'string' && r.trim().length > 0);
        if (validRoles.length > 0) {
          hasValidFilters = true;
        } else {
          missingFilterFields.push('roles');
        }
      } else {
        missingFilterFields.push('roles');
      }
      
      // Check for industries (array of strings)
      if (filters.industries && Array.isArray(filters.industries) && filters.industries.length > 0) {
        const validIndustries = filters.industries.filter(i => i && typeof i === 'string' && i.trim().length >= 2);
        if (validIndustries.length > 0) {
          hasValidFilters = true;
        } else {
          if (!missingFilterFields.includes('industries')) missingFilterFields.push('industries');
        }
      } else {
        if (!missingFilterFields.includes('industries')) missingFilterFields.push('industries');
      }
      
      // Check for location (string or array)
      if (filters.location) {
        if (typeof filters.location === 'string' && filters.location.trim().length > 0) {
          hasValidFilters = true;
        } else if (Array.isArray(filters.location) && filters.location.length > 0) {
          const validLocations = filters.location.filter(l => l && typeof l === 'string' && l.trim().length > 0);
          if (validLocations.length > 0) {
            hasValidFilters = true;
          } else {
            missingFilterFields.push('location');
          }
        } else {
          missingFilterFields.push('location');
        }
      } else {
        missingFilterFields.push('location');
      }
    }
    
    // Also check for leadGenerationLimit or leads_per_day as fallback
    const hasLimit = isFieldValid(stepConfig.leadGenerationLimit) || isFieldValid(stepConfig.leads_per_day);
    
    // Lead generation requires at least one of: valid filters OR limit
    if (!hasValidFilters && !hasLimit) {
      const missingFields = ['leadGenerationFilters'];
      if (!hasLimit) {
        missingFields.push('leadGenerationLimit');
      }
      
      return {
        valid: false,
        error: 'Lead generation step requires at least one filter criteria (roles, industries, or location) in leadGenerationFilters, or a leadGenerationLimit to be configured',
        missingFields: missingFields
      };
    }
    
    // Lead generation validation passed, skip other field checks
    return { valid: true };
  }
  
  // Special handling for voice_agent_call - accept either voiceContext or added_context
  if (stepType === 'voice_agent_call') {
    const hasVoiceContext = isFieldValid(stepConfig.voiceContext);
    const hasAddedContext = isFieldValid(stepConfig.added_context);
    if (!hasVoiceContext && !hasAddedContext) {
      missingFields.push('voiceContext');
    }
    // Remove voiceContext from requiredFields check since we handled it above
    requiredFields = requiredFields.filter(f => f !== 'voiceContext');
  }
  
  // Check all required fields
  for (const field of requiredFields) {
    const fieldValue = stepConfig[field];
    
    if (!isFieldValid(fieldValue)) {
      missingFields.push(field);
      invalidFields.push(field);
    }
  }
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}. Please configure all required fields in step settings.`,
      missingFields: missingFields
    };
  }
  
  return { valid: true };
}

/**
 * Execute a campaign step for a specific lead
 */
async function executeStepForLead(campaignId, step, campaignLead, userId, orgId) {
  // Declare activityId outside try block so it's accessible in catch
  let activityId = null;
  
  try {
    const stepType = step.type;
    const stepConfig = typeof step.config === 'string' ? JSON.parse(step.config) : step.config;
    
    // VALIDATE: Check if all required fields are filled before executing
    const validation = validateStepConfig(stepType, stepConfig);
    if (!validation.valid) {
      console.error(`[Campaign Execution] Step ${step.id} (${stepType}) validation failed:`, validation.error);
      console.error(`[Campaign Execution] Missing fields:`, validation.missingFields);
      
      return {
        success: false,
        error: validation.error,
        validationError: true,
        missingFields: validation.missingFields
      };
    }
    
    // For lead generation, campaignLead might be a dummy object
    const leadId = campaignLead?.lead_id || campaignLead?.id || 'N/A';
    console.log(`[Campaign Execution] Executing step ${step.id} (${stepType}) for lead ${leadId}`);
    console.log(`[Campaign Execution] Step config validated - all required fields present`);
    
    // Record activity start (skip for lead generation as it's campaign-level and creates leads)
    if (stepType !== 'lead_generation' && campaignLead && campaignLead.id) {
      const activityResult = await pool.query(
        `INSERT INTO campaign_lead_activities 
         (campaign_lead_id, step_id, step_type, action_type, status, channel, created_at)
         VALUES ($1, $2, $3, $4, 'sent', $5, CURRENT_TIMESTAMP)
         RETURNING id`,
        [campaignLead.id, step.id, stepType, stepType, getChannelForStepType(stepType)]
      );
      
      activityId = activityResult.rows[0].id;
    }
    
    let result = { success: false, error: 'Unknown step type' };
    
    // Handle all step types dynamically based on step type
    if (stepType === 'lead_generation') {
      result = await executeLeadGeneration(campaignId, step, stepConfig, userId, orgId);
    } else if (stepType.startsWith('linkedin_')) {
      // All LinkedIn steps: connect, message, follow, visit, scrape_profile, company_search, employee_list, autopost, comment_reply
      result = await executeLinkedInStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('email_')) {
      // All email steps: send, followup
      result = await executeEmailStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('whatsapp_')) {
      // WhatsApp steps: send
      result = await executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType.startsWith('instagram_')) {
      // Instagram steps: follow, like, dm, autopost, comment_reply, story_view
      result = await executeInstagramStep(stepType, stepConfig, campaignLead, userId, orgId);
    } else if (stepType === 'voice_agent_call') {
      result = await executeVoiceAgentStep(stepConfig, campaignLead, userId, orgId);
    } else if (stepType === 'delay') {
      result = await executeDelayStep(stepConfig);
    } else if (stepType === 'condition') {
      result = await executeConditionStep(stepConfig, campaignLead);
    } else if (stepType === 'start' || stepType === 'end') {
      // Start and end nodes are just markers, skip execution
      result = { success: true, message: 'Start/End node - no action needed' };
    } else {
      console.warn(`[Campaign Execution] Unknown step type: ${stepType} - marking as success to continue workflow`);
      result = { success: true, message: `Step type ${stepType} not yet implemented, but workflow continues` };
    }
    
    // Update activity status (only if activity was created)
    if (activityId) {
      const status = result.success ? 'delivered' : 'error';
      await pool.query(
        `UPDATE campaign_lead_activities 
         SET status = $1, 
             error_message = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [status, result.error || null, activityId]
      );
      
      // If step was successful, handle status updates based on step type
      if (result.success) {
        // For LinkedIn messages, mark as 'replied' if there's a reply, otherwise keep as 'delivered'
        if (stepType === 'linkedin_message') {
          // Messages are marked as 'delivered' when sent successfully
          // They will be updated to 'replied' when a reply is received (via webhook or polling)
          // Keep as 'delivered' for now
        }
        // For connection requests, keep as 'delivered' when sent
        // They will be updated to 'connected' when accepted (via webhook)
        // DO NOT mark as 'connected' immediately - wait for webhook confirmation
      }
    }
    
    return result;
  } catch (error) {
    console.error(`[Campaign Execution] Error executing step ${step.id}:`, error);
    
    // If activity was created, update it to error status
    if (activityId) {
      try {
        await pool.query(
          `UPDATE campaign_lead_activities 
           SET status = 'error', 
               error_message = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [error.message || 'Unknown error occurred', activityId]
        );
      } catch (updateErr) {
        console.error(`[Campaign Execution] Error updating activity status:`, updateErr);
      }
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Execute lead generation step with daily limit support
 */
async function executeLeadGeneration(campaignId, step, stepConfig, userId, orgId) {
  try {
    console.log('[Campaign Execution] Executing lead generation...');
    
    // Ensure stepConfig is parsed if it's a string
    if (typeof stepConfig === 'string') {
      stepConfig = JSON.parse(stepConfig);
    }
    
    // Get campaign to access config (leads_per_day, lead_gen_offset)
    // First try to get config from campaigns table (if config column exists)
    let campaignConfig = {};
    let configColumnExists = false;
    try {
      const campaignResult = await pool.query(
        `SELECT config FROM campaigns WHERE id = $1`,
        [campaignId]
      );
      
      if (campaignResult.rows[0]?.config) {
        campaignConfig = typeof campaignResult.rows[0].config === 'string' 
          ? JSON.parse(campaignResult.rows[0].config) 
          : campaignResult.rows[0].config;
        configColumnExists = true;
      }
    } catch (err) {
      // Config column might not exist, try reading from step config instead
      console.log('[Campaign Execution] Config column not available, checking step config');
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
      console.error('[Campaign Execution] Invalid leads_per_day setting');
      return { success: false, error: 'leads_per_day must be set and greater than 0' };
    }
    
    const configSource = campaignConfig.leads_per_day ? 'campaign config' 
                        : stepConfig.leads_per_day ? 'step config' 
                        : stepConfig.leadGenerationLimit ? 'step limit'
                        : 'default';
    console.log(`[Campaign Execution] Using user-selected leads_per_day: ${leadsPerDay} (from ${configSource})`);
    
    // Get current offset (how many leads have been processed so far)
    let currentOffset = campaignConfig.lead_gen_offset || stepConfig.lead_gen_offset || 0;
    
    // Check today's date to see if we need to process leads for today
    const today = new Date().toISOString().split('T')[0];
    const lastLeadGenDate = campaignConfig.last_lead_gen_date;
    
    // CRITICAL: If leads were already generated today, skip generation
    // This prevents duplicate lead generation when the server restarts
    if (lastLeadGenDate === today) {
      console.log(`[Campaign Execution] ⏭️  Leads already generated today (${today}). Skipping lead generation.`);
      console.log(`[Campaign Execution] Current offset: ${currentOffset} (already processed ${currentOffset} leads total)`);
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
    console.log(`[Campaign Execution] Today: ${today}, Last generation: ${lastLeadGenDate || 'never'}, Current offset: ${currentOffset}`);
    
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
    
    if (orgId) {
      searchParams.organization_id = orgId;
    }
    
    if (userId) {
      searchParams.user_id = userId;
    }
    
    console.log(`[Campaign Execution] Daily limit: ${dailyLimit}, Current offset: ${currentOffset}, Page: ${page}, Offset in page: ${offsetInPage}`);
    
    let employees = [];
    let fromSource = 'database';
    
    // STEP 1: Try to get leads from database first
    try {
      console.log('[Campaign Execution] Step 1: Checking database (employees_cache) - page', page);
      
      const dbResponse = await axios.post(
      `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
      searchParams,
      {
        headers: {
          'Content-Type': 'application/json'
        },
          timeout: 60000
        }
      );
      
      if (dbResponse.data && dbResponse.data.success !== false) {
        const dbEmployees = dbResponse.data.employees || dbResponse.data || [];
        console.log(`[Campaign Execution] Found ${dbEmployees.length} leads in database (page ${page})`);
        
        // Apply offset within this page and take daily limit
        const availableFromDb = dbEmployees.slice(offsetInPage, offsetInPage + dailyLimit);
        
        if (availableFromDb.length >= dailyLimit) {
          // We have enough from database
          employees = availableFromDb.slice(0, dailyLimit);
          fromSource = 'database';
          console.log(`[Campaign Execution] Using ${employees.length} leads from database`);
        } else {
          // Not enough in database, take what we have and fetch from Apollo
          employees = availableFromDb;
          fromSource = 'mixed';
          console.log(`[Campaign Execution] Only ${availableFromDb.length} leads available in database, will fetch ${dailyLimit - availableFromDb.length} from Apollo`);
        }
      }
    } catch (dbError) {
      console.warn('[Campaign Execution] Error fetching from database, will try Apollo:', dbError.message);
    }
    
    // STEP 2: If not enough leads from database, fetch from Apollo
    if (employees.length < dailyLimit) {
      try {
        console.log('[Campaign Execution] Step 2: Fetching from Apollo API - page', page);
        
        const neededFromApollo = dailyLimit - employees.length;
        const apolloOffset = offsetInPage;
        
        const apolloParams = {
          ...searchParams,
          page: page,
          per_page: fetchLimit
        };
        
        // Try calling Apollo API directly - if endpoint doesn't exist, fallback to database endpoint
        // The database endpoint may internally call Apollo if needed
        let apolloResponse;
        try {
          apolloResponse = await axios.post(
            `${BACKEND_URL}/api/apollo-leads/search-employees`,
            apolloParams,
            {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 60000
      }
    );
        } catch (apolloEndpointError) {
          // If Apollo endpoint doesn't exist, use database endpoint which may fetch from Apollo
          console.log('[Campaign Execution] Apollo endpoint not available, using database endpoint');
          apolloResponse = await axios.post(
            `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
            apolloParams,
            {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 60000
            }
          );
        }
        
        if (apolloResponse.data && apolloResponse.data.success !== false) {
          const apolloEmployees = apolloResponse.data.employees || apolloResponse.data || [];
          console.log(`[Campaign Execution] Found ${apolloEmployees.length} leads from Apollo (page ${page})`);
          
          // Apply offset within Apollo page and take what we need
          const availableFromApollo = apolloEmployees.slice(apolloOffset, apolloOffset + neededFromApollo);
          
          // Combine database leads with Apollo leads
          employees = [...employees, ...availableFromApollo].slice(0, dailyLimit);
          fromSource = employees.length > (dailyLimit - neededFromApollo) ? 'mixed' : 'apollo';
          
          console.log(`[Campaign Execution] Combined total: ${employees.length} leads (${employees.length - availableFromApollo.length} from DB, ${availableFromApollo.length} from Apollo)`);
        }
      } catch (apolloError) {
        console.error('[Campaign Execution] Error fetching from Apollo:', apolloError.message);
        // Continue with whatever we got from database
      }
    }
    
    console.log(`[Campaign Execution] Total leads to process today: ${employees.length} (from ${fromSource})`);
      
    // Save leads to campaign_leads table (only the daily limit)
    let savedCount = 0;
    let firstGeneratedLeadId = null; // Track first lead ID for activity creation
    for (const employee of employees) {
      try {
        // Apollo person IDs are hex strings, not UUIDs, so we can't use them in lead_id column
        // Instead, check if lead exists by querying the lead_data JSONB field
        const apolloPersonId = employee.id || employee.apollo_person_id;
        
        if (!apolloPersonId) {
          console.warn('[Campaign Execution] Employee missing apollo_person_id, skipping');
          continue;
        }
        
        // Check if lead already exists for this campaign by Apollo ID
        // Try lead_data first, fallback to custom_fields if lead_data doesn't exist
        let existingLead;
        try {
          existingLead = await pool.query(
            `SELECT id FROM campaign_leads 
             WHERE campaign_id = $1 AND lead_data->>'apollo_person_id' = $2`,
            [campaignId, String(apolloPersonId)]
          );
        } catch (err) {
          // If lead_data column doesn't exist, use custom_fields instead
          if (err.code === '42703' && err.message.includes('lead_data')) {
            console.log(`[Campaign Execution] lead_data column not found in duplicate check, using custom_fields`);
            existingLead = await pool.query(
              `SELECT id FROM campaign_leads 
               WHERE campaign_id = $1 AND custom_fields->>'apollo_person_id' = $2`,
              [campaignId, String(apolloPersonId)]
          );
          } else {
            console.error(`[Campaign Execution] Error checking for existing lead:`, err.message);
            throw err;
          }
        }
          
          if (existingLead.rows.length === 0) {
          // Generate a UUID for lead_id (Apollo IDs are hex strings, not UUIDs)
              const { randomUUID } = require('crypto');
          const leadId = randomUUID();
          
          // Ensure apollo_person_id is stored for future lookups
          const leadData = {
            ...employee,
            apollo_person_id: apolloPersonId
          };
          
          // Extract individual fields from employee data for database columns
          const nameParts = (employee.name || employee.employee_name || '').split(' ');
          const firstName = nameParts[0] || employee.first_name || null;
          const lastName = nameParts.slice(1).join(' ') || employee.last_name || null;
          const email = employee.email || employee.employee_email || employee.work_email || null;
          const linkedinUrl = employee.linkedin_url || employee.employee_linkedin_url || employee.linkedin || null;
          const companyName = employee.company_name || employee.organization?.name || employee.company?.name || null;
          const title = employee.title || employee.job_title || employee.employee_title || employee.headline || null;
          const phone = employee.phone || employee.employee_phone || employee.phone_number || null;
          
          // Try inserting with lead_data column, fallback to custom_fields if column doesn't exist
          try {
            const insertResult = await pool.query(
              `INSERT INTO campaign_leads 
               (campaign_id, lead_id, status, first_name, last_name, email, linkedin_url, company_name, title, phone, lead_data, created_at)
               VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
               RETURNING id`,
              [campaignId, leadId, firstName, lastName, email, linkedinUrl, companyName, title, phone, JSON.stringify(leadData)]
            );
            const insertedLeadId = insertResult.rows[0].id;
            savedCount++;
            // Track first generated lead ID (primary key) for activity creation
            if (!firstGeneratedLeadId) {
              firstGeneratedLeadId = insertedLeadId;
            }
            console.log(`[Campaign Execution] ✅ Successfully saved lead ${apolloPersonId} to campaign (UUID: ${insertedLeadId}, lead_id: ${leadId})`);
            
            // Verify the insert worked (using the returned primary key id)
            const verifyResult = await pool.query(
              `SELECT id, first_name, last_name, email FROM campaign_leads WHERE id = $1`,
              [insertedLeadId]
            );
            if (verifyResult.rows.length > 0) {
              console.log(`[Campaign Execution] ✅ Verification: Lead confirmed in database - ${verifyResult.rows[0].first_name} ${verifyResult.rows[0].last_name}`);
            } else {
              console.error(`[Campaign Execution] ❌ WARNING: Lead ${insertedLeadId} was not found after INSERT!`);
            }
          } catch (err) {
            // If lead_data column doesn't exist, use custom_fields instead
            if (err.code === '42703' && err.message.includes('lead_data')) {
              console.log(`[Campaign Execution] lead_data column not found, using custom_fields instead`);
              try {
            const insertResult = await pool.query(
              `INSERT INTO campaign_leads 
                   (campaign_id, lead_id, status, first_name, last_name, email, linkedin_url, company_name, title, phone, custom_fields, created_at)
                   VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
                   RETURNING id`,
                  [campaignId, leadId, firstName, lastName, email, linkedinUrl, companyName, title, phone, JSON.stringify(leadData)]
                );
                const insertedLeadId = insertResult.rows[0].id;
                savedCount++;
                // Track first generated lead ID (primary key) for activity creation
                if (!firstGeneratedLeadId) {
                  firstGeneratedLeadId = insertedLeadId;
                }
                console.log(`[Campaign Execution] ✅ Successfully saved lead ${apolloPersonId} to campaign (UUID: ${insertedLeadId}, lead_id: ${leadId}) - using custom_fields`);
                
                // Verify the insert worked (using the returned primary key id)
                const verifyResult = await pool.query(
                  `SELECT id, first_name, last_name, email FROM campaign_leads WHERE id = $1`,
                  [insertedLeadId]
            );
                if (verifyResult.rows.length > 0) {
                  console.log(`[Campaign Execution] ✅ Verification: Lead confirmed in database - ${verifyResult.rows[0].first_name} ${verifyResult.rows[0].last_name}`);
                } else {
                  console.error(`[Campaign Execution] ❌ WARNING: Lead ${insertedLeadId} was not found after INSERT!`);
                }
              } catch (fallbackErr) {
                console.error(`[Campaign Execution] ❌ Error saving lead with custom_fields:`, {
                  message: fallbackErr.message,
                  code: fallbackErr.code,
                  detail: fallbackErr.detail,
                  constraint: fallbackErr.constraint
                });
                throw fallbackErr;
              }
            } else {
              console.error(`[Campaign Execution] ❌ Error saving lead:`, {
                message: err.message,
                code: err.code,
                detail: err.detail,
                constraint: err.constraint,
                column: err.column,
                table: err.table
              });
              throw err;
            }
          }
        } else {
          console.log(`[Campaign Execution] ⏭️ Skipping lead ${apolloPersonId} - already exists in campaign (existing ID: ${existingLead.rows[0].id})`);
          }
        } catch (err) {
        console.error(`[Campaign Execution] ❌ Error processing lead ${apolloPersonId}:`, {
          message: err.message,
          code: err.code,
          detail: err.detail
        });
        }
      }
      
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
      await pool.query(
        `UPDATE campaigns SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(updatedConfig), campaignId]
      );
    } catch (updateError) {
      // If config column doesn't exist, store offset in step config as fallback
      console.log('[Campaign Execution] Config column not available, storing offset in step config');
      try {
        // Update step config with offset and date
        const updatedStepConfig = {
          ...stepConfig,
          lead_gen_offset: newOffset,
          last_lead_gen_date: today,
          leads_per_day: leadsPerDay
        };
        
        await pool.query(
          `UPDATE campaign_steps SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(updatedStepConfig), step.id]
        );
        console.log('[Campaign Execution] ✅ Stored offset in step config:', { offset: newOffset, date: today });
      } catch (stepUpdateErr) {
        console.error('[Campaign Execution] Error storing offset in step config:', stepUpdateErr);
      }
      
      // Also update campaign updated_at timestamp
      try {
        await pool.query(
          `UPDATE campaigns SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [campaignId]
        );
      } catch (err) {
        // Ignore - not critical
      }
    }
    
    console.log(`[Campaign Execution] Updated campaign offset: ${currentOffset} → ${newOffset} (saved ${savedCount} leads today)`);
    
    // Create activity record for lead generation step (if leads were saved and we have a lead ID)
    // This allows the analytics to track lead generation executions
    if (savedCount > 0 && firstGeneratedLeadId && step) {
      try {
        // Create activity with 'sent' status first (consistent with other steps)
        // The analytics query looks for status='sent' for lead_generation
        const activityStatus = 'sent'; // Always 'sent' for lead generation (represents successful execution)
        await pool.query(
          `INSERT INTO campaign_lead_activities 
           (campaign_lead_id, step_id, step_type, action_type, status, channel, created_at, updated_at)
           VALUES ($1, $2, 'lead_generation', 'lead_generation', $3, 'campaign', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [firstGeneratedLeadId, step.id, activityStatus]
        );
        console.log(`[Campaign Execution] ✅ Created lead generation activity record for ${savedCount} leads`);
      } catch (activityErr) {
        // Don't fail the whole process if activity creation fails
        console.error(`[Campaign Execution] Warning: Failed to create lead generation activity:`, activityErr.message);
      }
    }
    
    return { 
      success: true, 
      leadsFound: employees.length,
      leadsSaved: savedCount,
      dailyLimit: dailyLimit,
      currentOffset: newOffset,
      source: fromSource
    };
  } catch (error) {
    console.error('[Campaign Execution] Lead generation error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to get lead data from campaign_leads table
 * Tries lead_data first, falls back to custom_fields if lead_data doesn't exist
 */
async function getLeadData(campaignLeadId) {
  try {
    const leadDataResult = await pool.query(
      `SELECT lead_data FROM campaign_leads WHERE id = $1`,
      [campaignLeadId]
    );
    
    if (leadDataResult.rows.length === 0) {
      return null;
    }
    
    const leadData = typeof leadDataResult.rows[0].lead_data === 'string'
      ? JSON.parse(leadDataResult.rows[0].lead_data)
      : leadDataResult.rows[0].lead_data;
    
    return leadData;
  } catch (err) {
    // If lead_data column doesn't exist, use custom_fields instead
    if (err.code === '42703' && err.message.includes('lead_data')) {
      const leadDataResult = await pool.query(
        `SELECT custom_fields FROM campaign_leads WHERE id = $1`,
        [campaignLeadId]
      );
      
      if (leadDataResult.rows.length === 0) {
        return null;
      }
      
      const leadData = typeof leadDataResult.rows[0].custom_fields === 'string'
        ? JSON.parse(leadDataResult.rows[0].custom_fields)
        : leadDataResult.rows[0].custom_fields;
      
      return leadData;
    } else {
      throw err;
    }
  }
}

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
    
    // Get LinkedIn account with Unipile account ID
    // Strategy 1: Try linkedin_accounts table by organization_id
    let accountResult = await pool.query(
      `SELECT id, unipile_account_id FROM linkedin_accounts 
       WHERE organization_id = $1 
       AND is_active = TRUE
       AND unipile_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    
    console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in linkedin_accounts for org ${orgId}`);
    
    // Strategy 2: If not found, try user_integrations_voiceagent by user_id
    // Note: user_id might be integer or UUID, and unipile_account_id is in credentials JSONB
    if (accountResult.rows.length === 0 && userId) {
      console.log(`[Campaign Execution] No account in linkedin_accounts, checking user_integrations_voiceagent for user ${userId}...`);
      try {
        // Try with user_id as text (for UUID) or integer, check multiple credential field names
        accountResult = await pool.query(
          `SELECT id::text as id, 
                  COALESCE(
                    NULLIF(credentials->>'unipile_account_id', ''),
                    NULLIF(credentials->>'account_id', ''),
                    NULLIF(credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent 
           WHERE provider = 'linkedin'
           AND (user_id::text = $1 OR user_id = $1::integer)
           AND is_connected = TRUE
           AND (
             (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
             OR
             (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
             OR
             (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`,
          [userId]
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for user ${userId}`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent:`, err.message);
      }
    }
    
    // Strategy 3: If still not found, try user_integrations_voiceagent by organization_id (via users_voiceagent join)
    if (accountResult.rows.length === 0 && orgId) {
      console.log(`[Campaign Execution] No account found for user, checking user_integrations_voiceagent for org ${orgId}...`);
      try {
        accountResult = await pool.query(
          `SELECT uiv.id::text as id, 
                  COALESCE(
                    NULLIF(uiv.credentials->>'unipile_account_id', ''),
                    NULLIF(uiv.credentials->>'account_id', ''),
                    NULLIF(uiv.credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent uiv
           JOIN voice_agent.users_voiceagent uva ON uiv.user_id = uva.user_id
           WHERE uiv.provider = 'linkedin'
           AND uva.organization_id = $1::uuid
           AND uiv.is_connected = TRUE
           AND (
             (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
             OR
             (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
             OR
             (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
          [orgId]
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for org ${orgId}`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent by org:`, err.message);
      }
    }
    
    // Strategy 4: If still not found, try any active account in linkedin_accounts
    if (accountResult.rows.length === 0) {
      console.log(`[Campaign Execution] No account found for org/user, searching for any active account in linkedin_accounts...`);
      accountResult = await pool.query(
        `SELECT id, unipile_account_id FROM linkedin_accounts 
         WHERE is_active = TRUE
         AND unipile_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      console.log(`[Campaign Execution] Found ${accountResult.rows.length} active LinkedIn account(s) globally in linkedin_accounts`);
    }
    
    // Strategy 5: Last resort - try any active account in user_integrations_voiceagent
    if (accountResult.rows.length === 0) {
      console.log(`[Campaign Execution] No account in linkedin_accounts, searching for any active account in user_integrations_voiceagent...`);
      try {
        accountResult = await pool.query(
          `SELECT id::text as id, 
                  COALESCE(
                    NULLIF(credentials->>'unipile_account_id', ''),
                    NULLIF(credentials->>'account_id', ''),
                    NULLIF(credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent 
           WHERE provider = 'linkedin'
           AND is_connected = TRUE
           AND (
             (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
             OR
             (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
             OR
             (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} active LinkedIn account(s) globally in user_integrations_voiceagent`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent globally:`, err.message);
      }
    }
    
    if (accountResult.rows.length === 0) {
      console.error(`[Campaign Execution] ❌ No active LinkedIn account connected with Unipile. Org ID: ${orgId}`);
      console.error(`[Campaign Execution] To fix this: Go to Settings → LinkedIn Integration and connect a LinkedIn account`);
      return { 
        success: false, 
        error: 'No active LinkedIn account connected with Unipile. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
        userAction: 'Connect LinkedIn account in Settings'
      };
    }
    
    const linkedinAccountId = accountResult.rows[0].unipile_account_id;
    
    if (!linkedinAccountId) {
      console.error(`[Campaign Execution] ❌ LinkedIn account found but unipile_account_id is null. Account ID: ${accountResult.rows[0].id}`);
      return { success: false, error: 'LinkedIn account does not have Unipile account ID configured' };
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
      // Only include message if user explicitly provided one (not default)
      const message = stepConfig.message || stepConfig.connectionMessage || null;
      // Don't use default message - send without message to avoid monthly limit
      console.log(`[Campaign Execution] LinkedIn connect step - sending connection request ${message ? 'with custom message' : 'without message (to avoid monthly limit)'} to ${employee.fullname}`);
      result = await unipileService.sendConnectionRequest(employee, message, linkedinAccountId);
      
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
        if (profileResult && profileResult.success !== false) {
          console.log(`[Campaign Execution] ✅ Successfully visited profile for ${employee.fullname} via Unipile`);
          result = {
            success: true,
            message: 'Profile visited via Unipile and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          
          // After successfully visiting profile, generate summary automatically
          try {
            console.log(`[Campaign Execution] Generating profile summary for ${employee.fullname} after visit`);
            const profileData = profileResult.profile || profileResult;
            const summaryLead = {
              name: leadData.name || leadData.employee_name || employee.fullname,
              title: leadData.title || leadData.employee_title || profileData.headline || profileData.title,
              company: leadData.company_name || leadData.company || profileData.company,
              location: leadData.location || leadData.city || leadData.employee_city || profileData.location,
              linkedin_url: linkedinUrl,
              headline: profileData.headline || leadData.headline || leadData.employee_headline,
              bio: profileData.summary || profileData.bio || leadData.bio || leadData.summary,
              ...leadData,
              ...profileData
            };
            
            const summaryResult = await generateProfileSummary(
              summaryLead,
              campaignLead.id,
              campaignLead.campaign_id
            );
            
            if (summaryResult.success) {
              console.log(`[Campaign Execution] ✅ Profile summary generated successfully for ${employee.fullname}`);
            } else {
              console.warn(`[Campaign Execution] ⚠️ Failed to generate summary: ${summaryResult.error}`);
            }
          } catch (summaryErr) {
            // Don't fail the visit step if summary generation fails
            console.error('[Campaign Execution] Error generating profile summary after visit:', summaryErr);
          }
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

/**
 * Execute email step
 */
async function executeEmailStep(stepType, stepConfig, campaignLead, userId, orgId) {
  try {
    console.log(`[Campaign Execution] Executing email step: ${stepType}`);
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const email = leadData.email || leadData.employee_email;
    if (!email) {
      return { success: false, error: 'Email not found for lead' };
    }
    
    const subject = stepConfig.subject || stepConfig.emailSubject || 'Re: {{company_name}}';
    const body = stepConfig.body || stepConfig.emailBody || stepConfig.message || 'Hi {{first_name}},...';
    
    // TODO: Implement actual email sending via SMTP or email service
    console.log(`[Campaign Execution] Email step recorded - would send to ${email}`);
    
    return { success: true, email, subject, body };
  } catch (error) {
    console.error('[Campaign Execution] Email step error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute WhatsApp step
 */
async function executeWhatsAppStep(stepType, stepConfig, campaignLead, userId, orgId) {
  try {
    console.log(`[Campaign Execution] Executing WhatsApp step: ${stepType}`);
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const phone = leadData.phone || leadData.employee_phone;
    if (!phone) {
      return { success: false, error: 'Phone number not found for lead' };
    }
    
    const message = stepConfig.whatsappMessage || stepConfig.message || 'Hi {{first_name}},...';
    
    // TODO: Implement actual WhatsApp sending
    console.log(`[Campaign Execution] WhatsApp step recorded - would send to ${phone}`);
    
    return { success: true, phone, message };
  } catch (error) {
    console.error('[Campaign Execution] WhatsApp step error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute Instagram step
 */
async function executeInstagramStep(stepType, stepConfig, campaignLead, userId, orgId) {
  try {
    console.log(`[Campaign Execution] Executing Instagram step: ${stepType}`);
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    // TODO: Implement actual Instagram actions
    console.log(`[Campaign Execution] Instagram step recorded: ${stepType}`);
    
    return { success: true, stepType };
  } catch (error) {
    console.error('[Campaign Execution] Instagram step error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute voice agent step
 */
async function executeVoiceAgentStep(stepConfig, campaignLead, userId, orgId) {
  try {
    console.log('[Campaign Execution] Executing voice agent step...');
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      return { success: false, error: 'Lead not found' };
    }
    
    const phone = leadData.phone || leadData.employee_phone;
    if (!phone) {
      return { success: false, error: 'Phone number not found for lead' };
    }
    
    const leadName = leadData.name || leadData.employee_name || 'there';
    const agentId = stepConfig.voiceAgentId || stepConfig.agent_id;
    const addedContext = stepConfig.voiceContext || stepConfig.added_context || '';
    
    // Call voice agent API (internal call, no auth needed)
    const response = await axios.post(
      `${BACKEND_URL}/api/voiceagents/calls`,
      {
        agent_id: agentId,
        to_number: phone,
        lead_name: leadName,
        added_context: addedContext,
        initiated_by: userId
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );
    
    if (response.data && response.data.success !== false) {
      return { success: true };
    } else {
      return { success: false, error: response.data?.error || 'Failed to initiate call' };
    }
  } catch (error) {
    console.error('[Campaign Execution] Voice agent step error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute delay step
 */
async function executeDelayStep(stepConfig) {
  const delayDays = stepConfig.delay_days || stepConfig.delayDays || 0;
  const delayHours = stepConfig.delay_hours || stepConfig.delayHours || 0;
  const totalMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000);
  
  console.log(`[Campaign Execution] Delaying for ${delayDays} days, ${delayHours} hours`);
  
  // In a real implementation, you'd schedule this for later
  // For now, we'll just return success (the delay should be handled by the scheduler)
  return { success: true, delayMs: totalMs };
}

/**
 * Execute condition step
 */
async function executeConditionStep(stepConfig, campaignLead) {
  const conditionType = stepConfig.condition || stepConfig.conditionType;
  
  // Check if condition is met
  const activitiesResult = await pool.query(
    `SELECT status FROM campaign_lead_activities 
     WHERE campaign_lead_id = $1 
     ORDER BY created_at DESC LIMIT 10`,
    [campaignLead.id]
  );
  
  const activities = activitiesResult.rows;
  let conditionMet = false;
  
  switch (conditionType) {
    case 'connected':
      conditionMet = activities.some(a => a.status === 'connected');
      break;
    case 'replied':
      conditionMet = activities.some(a => a.status === 'replied');
      break;
    case 'opened':
      conditionMet = activities.some(a => a.status === 'opened');
      break;
    default:
      conditionMet = true; // Default to true if condition type unknown
  }
  
  return { success: true, conditionMet };
}

/**
 * Get channel for step type
 */
function getChannelForStepType(stepType) {
  if (stepType.includes('linkedin')) return 'linkedin';
  if (stepType.includes('email')) return 'email';
  if (stepType.includes('whatsapp')) return 'whatsapp';
  if (stepType.includes('voice') || stepType.includes('call')) return 'voice';
  if (stepType.includes('instagram')) return 'instagram';
  return 'other';
}

/**
 * Process a running campaign
 */
async function processCampaign(campaignId) {
  try {
    console.log(`[Campaign Execution] Processing campaign ${campaignId}`);
    
    // Get campaign
    const campaignResult = await pool.query(
      `SELECT * FROM campaigns WHERE id = $1 AND status = 'running' AND is_deleted = FALSE`,
      [campaignId]
    );
    
    if (campaignResult.rows.length === 0) {
      console.log(`[Campaign Execution] Campaign ${campaignId} not found or not running`);
      return;
    }
    
    const campaign = campaignResult.rows[0];
    
    // Get campaign steps in order
    const stepsResult = await pool.query(
      `SELECT * FROM campaign_steps 
       WHERE campaign_id = $1 
       ORDER BY "order" ASC`,
      [campaignId]
    );
    
    const steps = stepsResult.rows;
    if (steps.length === 0) {
      console.log(`[Campaign Execution] No steps found for campaign ${campaignId}`);
      return;
    }
    
    // Check if lead generation step exists - run daily lead generation
    console.log(`[Campaign Execution] Campaign ${campaignId} has ${steps.length} steps. Step types:`, steps.map(s => s.type));
    const leadGenStep = steps.find(s => s.type === 'lead_generation');
    if (leadGenStep) {
      // Always run lead generation daily (respects daily limit and offset)
      console.log(`[Campaign Execution] Executing daily lead generation step for campaign ${campaignId}`);
        const dummyLead = { id: null, lead_id: 'lead_gen', campaign_id: campaignId };
      const leadGenResult = await executeStepForLead(campaignId, leadGenStep, dummyLead, campaign.created_by, campaign.organization_id);
      console.log(`[Campaign Execution] Lead generation result:`, leadGenResult);
      } else {
      console.warn(`[Campaign Execution] No lead_generation step found for campaign ${campaignId}. Steps:`, steps.map(s => ({ id: s.id, type: s.type, title: s.title })));
      console.warn(`[Campaign Execution] Campaign will not generate leads automatically. Make sure the campaign was created with target criteria (industries, location, or roles).`);
    }
    
    // Get active leads for this campaign
    const leadsResult = await pool.query(
      `SELECT * FROM campaign_leads 
       WHERE campaign_id = $1 AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 10`,
      [campaignId]
    );
    
    const leads = leadsResult.rows;
    
    // Process each lead through the workflow (skip lead generation, start, and end steps)
    const workflowSteps = steps.filter(s => 
      s.type !== 'lead_generation' && 
      s.type !== 'start' && 
      s.type !== 'end'
    );
    
    for (const lead of leads) {
      await processLeadThroughWorkflow(campaign, workflowSteps, lead, campaign.created_by, campaign.organization_id);
    }
    
    console.log(`[Campaign Execution] Processed ${leads.length} leads for campaign ${campaignId}`);
  } catch (error) {
    console.error(`[Campaign Execution] Error processing campaign ${campaignId}:`, error);
  }
}

/**
 * Process a lead through the workflow steps
 */
async function processLeadThroughWorkflow(campaign, steps, campaignLead, userId, orgId) {
  try {
    // Find the last successfully completed step for this lead
    // This ensures we don't re-execute steps that were already completed
    const lastSuccessfulActivityResult = await pool.query(
      `SELECT step_id, status, created_at FROM campaign_lead_activities 
       WHERE campaign_lead_id = $1 
       AND status IN ('delivered', 'connected', 'replied')
       ORDER BY created_at DESC LIMIT 1`,
      [campaignLead.id]
    );
    
    let nextStepIndex = 0;
    if (lastSuccessfulActivityResult.rows.length > 0) {
      const lastSuccessfulActivity = lastSuccessfulActivityResult.rows[0];
      const lastSuccessfulStepIndex = steps.findIndex(s => s.id === lastSuccessfulActivity.step_id);
      if (lastSuccessfulStepIndex >= 0) {
        // Advance to the step after the last successfully completed step
        nextStepIndex = lastSuccessfulStepIndex + 1;
        console.log(`[Campaign Execution] Last successful step for lead ${campaignLead.id}: step ${lastSuccessfulStepIndex} (${lastSuccessfulActivity.step_id}), advancing to step ${nextStepIndex}`);
      }
    } else {
      // No successful activities yet, start from the beginning
      console.log(`[Campaign Execution] No successful activities found for lead ${campaignLead.id}, starting from step 0`);
    }
    
    if (nextStepIndex >= steps.length) {
      // All steps completed, mark lead as completed
      await pool.query(
        `UPDATE campaign_leads SET status = 'completed' WHERE id = $1`,
        [campaignLead.id]
      );
      return;
    }
    
    const nextStep = steps[nextStepIndex];
    
    // CRITICAL: Check if this step has already been successfully executed for this lead
    // This prevents duplicate execution of steps like "Visit LinkedIn Profile" or "Send Connection Request"
    const existingActivityResult = await pool.query(
      `SELECT id, status FROM campaign_lead_activities 
       WHERE campaign_lead_id = $1 
       AND step_id = $2 
       AND status IN ('delivered', 'connected', 'replied')
       ORDER BY created_at DESC LIMIT 1`,
      [campaignLead.id, nextStep.id]
    );
    
    if (existingActivityResult.rows.length > 0) {
      const existingActivity = existingActivityResult.rows[0];
      console.log(`[Campaign Execution] ⏭️  Step ${nextStep.id} (${nextStep.type}) already completed for lead ${campaignLead.id} with status: ${existingActivity.status}. Skipping duplicate execution.`);
      
      // Step already completed successfully, advance to next step
      const currentStepIndex = steps.findIndex(s => s.id === nextStep.id);
      if (currentStepIndex >= 0 && currentStepIndex < steps.length - 1) {
        // Recursively process the next step
        const remainingSteps = steps.slice(currentStepIndex + 1);
        await processLeadThroughWorkflow(campaign, remainingSteps, campaignLead, userId, orgId);
      }
      return;
    }
    
    // Validate step before execution - check if all required fields are filled by user
    const stepConfig = typeof nextStep.config === 'string' ? JSON.parse(nextStep.config) : nextStep.config;
    const validation = validateStepConfig(nextStep.type, stepConfig);
    
    if (!validation.valid) {
      // Step validation failed - required fields not filled by user
      console.error(`[Campaign Execution] Step ${nextStep.id} (${nextStep.type}) validation failed for lead ${campaignLead.id}`);
      console.error(`[Campaign Execution] Error: ${validation.error}`);
      console.error(`[Campaign Execution] Missing required fields: ${validation.missingFields.join(', ')}`);
      console.error(`[Campaign Execution] User must fill all required fields in step settings before execution`);
      
      // Record validation error in activity
      await pool.query(
        `INSERT INTO campaign_lead_activities 
         (campaign_lead_id, step_id, step_type, action_type, status, error_message, created_at)
         VALUES ($1, $2, $3, $4, 'error', $5, CURRENT_TIMESTAMP)`,
        [
          campaignLead.id,
          nextStep.id,
          nextStep.type,
          nextStep.type,
          `Validation failed: ${validation.error}. Missing required fields: ${validation.missingFields.join(', ')}. Please configure all required fields in step settings.`
        ]
      );
      
      // Mark lead as stopped because step configuration is incomplete
      await pool.query(
        `UPDATE campaign_leads SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [campaignLead.id]
      );
      
      console.log(`[Campaign Execution] Lead ${campaignLead.id} stopped due to incomplete step configuration. User must complete step settings.`);
      return;
    }
    
    console.log(`[Campaign Execution] Step ${nextStep.id} (${nextStep.type}) validation passed - all required fields configured`);
    
    // Check if this is a delay step - if so, check if delay has passed
    // (stepConfig already parsed above during validation)
    if (nextStep.type === 'delay') {
      const delayDays = stepConfig.delay_days || stepConfig.delayDays || 0;
      const delayHours = stepConfig.delay_hours || stepConfig.delayHours || 0;
      
      // Check last activity time
      if (lastActivityResult.rows.length > 0) {
        const lastActivityTime = new Date(lastActivityResult.rows[0].created_at || campaignLead.created_at);
        const now = new Date();
        const delayMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000);
        
        if (now - lastActivityTime < delayMs) {
          // Delay not yet passed, skip this lead for now
          return;
        }
      }
    }
    
    // Check if this is a condition step
    // (stepConfig already parsed above during validation)
    if (nextStep.type === 'condition') {
      const conditionResult = await executeConditionStep(stepConfig, campaignLead);
      
      if (!conditionResult.conditionMet) {
        // Condition not met, mark lead as stopped
        await pool.query(
          `UPDATE campaign_leads SET status = 'stopped' WHERE id = $1`,
          [campaignLead.id]
        );
        return;
      }
    }
    
    // Execute the step
    await executeStepForLead(campaign.id, nextStep, campaignLead, userId, orgId);
    
  } catch (error) {
    console.error(`[Campaign Execution] Error processing lead ${campaignLead.id}:`, error);
  }
}

module.exports = {
  executeStepForLead,
  processCampaign,
  processLeadThroughWorkflow
};

