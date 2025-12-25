/**
 * Lead Generation Service
 * Handles lead generation with daily limits and offset tracking
 */

const { pool } = require('../../../shared/database/connection');
const { searchEmployees } = require('./LeadSearchService');

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
    
    // Search for employees using LeadSearchService
    const { employees, fromSource } = await searchEmployees(searchParams, page, offsetInPage, dailyLimit);
    
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

module.exports = {
  executeLeadGeneration
};

