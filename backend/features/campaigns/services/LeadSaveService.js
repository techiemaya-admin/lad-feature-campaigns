/**
 * Lead Save Service
 * Handles saving leads to database (leads and campaign_leads tables)
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
const {
  checkLeadExists,
  extractLeadFields,
  createSnapshot,
  saveLeadToCampaign
} = require('./LeadGenerationHelpers');
/**
 * Save multiple leads to campaign
 * @param {string} campaignId - Campaign ID
 * @param {string} tenantId - Tenant ID
 * @param {Array} employees - Array of employee objects
 * @param {string} platform - Platform type ('linkedin', 'email', 'whatsapp', etc.)
 * @returns {Object} { savedCount, firstGeneratedLeadId }
 */
async function saveLeadsToCampaign(campaignId, tenantId, employees, platform = null) {
  const logger = require('../../../core/utils/logger');
  
  logger.info('[saveLeadsToCampaign] Starting', {
    campaignId,
    tenantId,
    employeesCount: employees?.length || 0
  });
  
  let savedCount = 0;
  let firstGeneratedLeadId = null;
  let skippedCount = 0;
  let skippedReasons = {
    noSourceId: 0,
    uuidFormat: 0,
    alreadyExists: 0,
    processingError: 0
  };
  let skippedDetails = [];

  for (const employee of employees) {
    // DETECT SOURCE: Use provided platform, or check if this lead came from Unipile/Apollo
    // Priority: 1) provided platform, 2) employee._source, 3) default 'apollo_io'
    const source = platform || employee._source || 'apollo_io';
    // Extract the appropriate ID based on source
    let sourceId = null;
    if (source === 'unipile') {
      // Unipile leads have 'id' field (or use profile_id as fallback)
      sourceId = employee.id || employee.profile_id || 'unknown';
    } else {
      // Apollo leads have 'apollo_person_id' or 'id'
      sourceId = employee.apollo_person_id || employee.id || 'unknown';
    }
    // Validate that sourceId is NOT a UUID (which would indicate database ID corruption)
    const isUUIDFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sourceId));
    try {
      if (!sourceId || sourceId === 'unknown') {
        logger.warn('[saveLeadsToCampaign] Skipping lead - no sourceId', { employee: employee.name });
        skippedCount++;
        skippedReasons.noSourceId++;
        skippedDetails.push({
          name: employee.name || 'Unknown',
          reason: 'No sourceId (Apollo person ID or Unipile ID)',
          source
        });
        continue;
      }
      if (isUUIDFormat) {
        logger.warn('[saveLeadsToCampaign] Skipping lead - UUID format sourceId', { sourceId });
        skippedCount++;
        skippedReasons.uuidFormat++;
        skippedDetails.push({
          name: employee.name || 'Unknown',
          reason: 'UUID format sourceId (data corruption)',
          sourceId
        });
        continue;
      }
      // Check if lead already exists
      const existingLead = await checkLeadExists(campaignId, sourceId);
      
      logger.info('[saveLeadsToCampaign] Lead check', {
        sourceId,
        exists: !!existingLead,
        source
      });
      
      if (!existingLead) {
        // Create clean leadData object with only necessary fields
        // Support both Unipile and Apollo field names
        // For Apollo leads, linkedin_url might be nested in employee_data
        let linkedinUrlValue = employee.linkedin_url || employee.linkedin || employee.profile_url || employee.public_profile_url;
        // If not found at top level, check in employee_data (Apollo structure)
        if (!linkedinUrlValue && employee.employee_data) {
          const employeeDataObj = typeof employee.employee_data === 'string' 
            ? JSON.parse(employee.employee_data) 
            : employee.employee_data;
          linkedinUrlValue = employeeDataObj.linkedin_url || employeeDataObj.linkedin || employeeDataObj.profile_url;
        }
        // FIX: Ensure we always have name fields, even if enrichment failed
        // Extract name from whatever data is available
        let extractedName = employee.name || employee.employee_name || null;
        let extractedFirstName = employee.first_name || null;
        let extractedLastName = employee.last_name || null;
        
        // If we have a full name but no first/last, try to parse it
        if (extractedName && (!extractedFirstName || !extractedLastName)) {
          const nameParts = extractedName.trim().split(/\s+/);
          if (nameParts.length > 0 && !extractedFirstName) {
            extractedFirstName = nameParts[0];
          }
          if (nameParts.length > 1 && !extractedLastName) {
            extractedLastName = nameParts.slice(1).join(' ');
          }
        }
        
        // If we have first/last but no full name, construct it
        if (!extractedName && (extractedFirstName || extractedLastName)) {
          extractedName = [extractedFirstName, extractedLastName].filter(Boolean).join(' ');
        }
        
        // If still no name, use title or email prefix as fallback
        if (!extractedName) {
          if (employee.title) {
            extractedName = `${employee.title} (Lead)`;
          } else if (employee.email) {
            const emailPrefix = employee.email.split('@')[0];
            extractedName = emailPrefix.replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          } else if (employee.headline) {
            extractedName = employee.headline;
          }
        }
        
        const leadData = {
          id: sourceId,  // Explicitly set id to the source person ID
          name: extractedName,
          first_name: extractedFirstName,
          last_name: extractedLastName,
          title: employee.title || employee.job_title || employee.headline,
          email: employee.email || employee.work_email,
          phone: employee.phone || employee.phone_number || employee.sanitized_phone,
          linkedin_url: linkedinUrlValue,
          // Company information
          company_id: employee.company_id,
          company_name: employee.company_name,
          company_domain: employee.company_domain,
          // Additional profile fields from Apollo
          photo_url: employee.photo_url || employee.profile_picture_url,
          headline: employee.headline,
          city: employee.city,
          state: employee.state,
          country: employee.country,
          // Extended Apollo data - store ALL fields
          personal_emails: employee.personal_emails || [],
          phone_numbers: employee.phone_numbers || [],
          sanitized_phone: employee.sanitized_phone,
          employment_history: employee.employment_history,
          education: employee.education,
          seniority: employee.seniority,
          departments: employee.departments,
          functions: employee.functions,
          // Full organization object with all details
          organization: employee.organization,
          // Enrichment metadata
          is_enriched: employee.is_enriched || false,
          enriched_at: employee.enriched_at,
          _enriched_data: employee._enriched_data,
          // Source tracking
          source: source, // Track which source this lead came from
          // Store complete Apollo response
          _full_data: employee
        };
        // Extract fields and create snapshot
        const fields = extractLeadFields(employee);
        const snapshot = createSnapshot(fields);
        
        logger.info('[saveLeadsToCampaign] Creating lead', {
          sourceId,
          name: employee.name
        });
        
        // Find or create lead with proper source detection
        const leadId = await findOrCreateLead(tenantId, sourceId, fields, leadData, source);
        
        logger.info('[saveLeadsToCampaign] Lead created/found', {
          sourceId,
          leadId
        });
        
        // Save lead to campaign
        try {
          const insertedLeadId = await saveLeadToCampaign(campaignId, tenantId, leadId, snapshot, leadData);
          savedCount++;
          logger.info('[saveLeadsToCampaign] Lead saved to campaign', {
            sourceId,
            insertedLeadId,
            savedCount
          });
          // Track first generated lead ID (primary key) for activity creation
          if (!firstGeneratedLeadId) {
            firstGeneratedLeadId = insertedLeadId;
          }
        } catch (err) {
          logger.error('[saveLeadsToCampaign] Failed to save lead to campaign', {
            sourceId,
            error: err.message,
            stack: err.stack
          });
          // Continue to next lead instead of throwing
        }
      } else {
        // Lead already exists, skip it
        skippedCount++;
        skippedReasons.alreadyExists++;
        logger.info('[saveLeadsToCampaign] Lead already exists in campaign, skipping', {
          sourceId,
          name: employee.name
        });
      }
    } catch (err) {
      skippedCount++;
      skippedReasons.processingError++;
      skippedDetails.push({
        name: employee.name || 'Unknown',
        reason: err.message
      });
      logger.error('[saveLeadsToCampaign] Failed to process lead', {
        employee: employee.name,
        error: err.message,
        stack: err.stack
      });
      // Continue to next lead instead of stopping
    }
  }

  // Log comprehensive summary
  logger.info('[saveLeadsToCampaign] Summary', {
    campaignId,
    totalProcessed: employees.length,
    saved: savedCount,
    skipped: skippedCount,
    skippedBreakdown: skippedReasons,
    firstGeneratedLeadId
  });

  if (skippedDetails.length > 0 && skippedDetails.length <= 10) {
    logger.warn('[saveLeadsToCampaign] Skipped leads details', {
      count: skippedDetails.length,
      details: skippedDetails
    });
  }

  return { savedCount, firstGeneratedLeadId, skippedCount, skippedReasons };
}
/**
 * Find or create lead in leads table
 * @param {string} tenantId - Tenant ID
 * @param {string} sourceId - The ID from the source (Apollo person ID or Unipile ID)
 * @param {Object} fields - Lead fields
 * @param {Object} leadData - Full lead data
 * @param {string} source - Source identifier ('apollo_io' or 'unipile')
 */
async function findOrCreateLead(tenantId, sourceId, fields, leadData, source = 'apollo_io') {
  let leadId = null;
  try {
    // Find existing lead by source_id and source
    const schema = getSchema(null);
    const findLeadResult = await pool.query(
      `SELECT id FROM ${schema}.leads 
       WHERE tenant_id = $1 AND source_id = $2 AND source = $3
       LIMIT 1`,
      [tenantId, sourceId, source]
    );
    if (findLeadResult.rows.length > 0) {
      leadId = findLeadResult.rows[0].id;
    } else {
      // Create new lead with UUID id, store source_id properly
      const { randomUUID } = require('crypto');
      leadId = randomUUID();
      
      logger.info('[findOrCreateLead] Attempting lead INSERT', { 
        leadId, 
        tenantId, 
        source, 
        sourceId,
        email: fields.email,
        company: fields.company_name
      });
      
      const insertResult = await pool.query(
        `INSERT INTO ${schema}.leads (
          id, tenant_id, source, source_id, 
          first_name, last_name, email, phone, 
          company_name, title, linkedin_url, 
          custom_fields, raw_data, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, id) DO UPDATE SET
          source_id = EXCLUDED.source_id,
          custom_fields = EXCLUDED.custom_fields,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id`,
        [
          leadId,
          tenantId,
          source, // Use the detected source
          sourceId, // The actual source ID (Apollo person ID or Unipile ID)
          fields.first_name || null,
          fields.last_name || null,
          fields.email || null,
          fields.phone || null,
          fields.company_name || null,
          fields.title || null,
          fields.linkedin_url || null,
          JSON.stringify({ source_id: sourceId, source }), // custom_fields
          JSON.stringify(leadData) // raw_data - full lead data
        ]
      );
      
      logger.info('[findOrCreateLead] Lead INSERT successful', {
        leadId: insertResult.rows[0]?.id,
        rowCount: insertResult.rowCount
      });
    }
  } catch (leadErr) {
    logger.error('[findOrCreateLead] Lead INSERT failed', {
      error: leadErr.message,
      code: leadErr.code,
      stack: leadErr.stack,
      tenantId,
      sourceId
    });
    
    // If leads table doesn't exist or has different schema, generate UUID and continue
    if (leadErr.code === '42P01') {
      const { randomUUID } = require('crypto');
      leadId = randomUUID();
    } else if (leadErr.code === '42703') {
      // Column doesn't exist, try without source column
      try {
        const { randomUUID } = require('crypto');
        leadId = randomUUID();
        const schema = getSchema(req);
        await pool.query(
          `INSERT INTO ${schema}.leads (id, tenant_id, first_name, last_name, email, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (id, tenant_id) DO NOTHING`,
          [
            leadId,
            tenantId,
            fields.first_name || null,
            fields.last_name || null,
            fields.email || null
          ]
        );
      } catch (retryErr) {
        const { randomUUID } = require('crypto');
        leadId = randomUUID();
      }
    } else {
      // Generate UUID anyway to continue
      const { randomUUID } = require('crypto');
      leadId = randomUUID();
    }
  }
  return leadId;
}

module.exports = {
  saveLeadsToCampaign,
  findOrCreateLead
};
