/**
 * Lead Save Service
 * Handles saving leads to database (leads and campaign_leads tables)
 */
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
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
 * @returns {Object} { savedCount, firstGeneratedLeadId }
 */
async function saveLeadsToCampaign(campaignId, tenantId, employees) {
  let savedCount = 0;
  let firstGeneratedLeadId = null;
  for (const employee of employees) {
    // DETECT SOURCE: Check if this lead came from Unipile or Apollo
    const source = employee._source || 'apollo_io'; // Default to apollo_io for backward compatibility
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
          employeeName: employee.name || employee.employee_name,
          source 
        });
        continue;
      }
      if (isUUIDFormat) {
          name: employee.name || employee.employee_name,
          id: sourceId,
          source
        });
        continue;
      }
      // Check if lead already exists
      const existingLead = await checkLeadExists(campaignId, sourceId);
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
        const leadData = {
          id: sourceId,  // Explicitly set id to the source person ID
          name: employee.name || employee.employee_name,
          first_name: employee.first_name,
          last_name: employee.last_name,
          title: employee.title || employee.job_title || employee.headline,
          email: employee.email || employee.work_email,
          phone: employee.phone || employee.phone_number,
          linkedin_url: linkedinUrlValue,
          company_id: employee.company_id,
          company_name: employee.company_name,
          company_domain: employee.company_domain,
          photo_url: employee.photo_url || employee.profile_picture_url,
          headline: employee.headline,
          city: employee.city,
          state: employee.state,
          country: employee.country,
          source: source, // Track which source this lead came from
          _full_data: employee
        };
        // Extract fields and create snapshot
        const fields = extractLeadFields(employee);
        const snapshot = createSnapshot(fields);
        // Find or create lead with proper source detection
        const leadId = await findOrCreateLead(tenantId, sourceId, fields, leadData, source);
        // Save lead to campaign
        try {
          const insertedLeadId = await saveLeadToCampaign(campaignId, tenantId, leadId, snapshot, leadData);
          savedCount++;
          // Track first generated lead ID (primary key) for activity creation
          if (!firstGeneratedLeadId) {
            firstGeneratedLeadId = insertedLeadId;
          }
            sourceId, 
            source,
            campaignLeadId: insertedLeadId, 
            leadId 
          });
        } catch (err) {
            sourceId,
            source,
            message: err.message,
            code: err.code,
            detail: err.detail,
            constraint: err.constraint
          });
          // Continue to next lead instead of throwing
        }
      } else {
          sourceId, 
          source,
          existingLeadId: existingLead.id 
        });
      }
    } catch (err) {
        sourceId,
        source,
        message: err.message,
        code: err.code,
        detail: err.detail
      });
      // Continue to next lead instead of stopping
    }
  }
  return { savedCount, firstGeneratedLeadId };
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
    const schema = getSchema(req);
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
      await pool.query(
        `INSERT INTO ${schema}.leads (
          id, tenant_id, source, source_id, 
          first_name, last_name, email, phone, 
          company_name, title, linkedin_url, 
          custom_fields, raw_data, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id, tenant_id) DO UPDATE SET
          source_id = EXCLUDED.source_id,
          custom_fields = EXCLUDED.custom_fields,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP`,
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
        sourceId, 
        source,
        leadId, 
        sourceIdentifier: source === 'unipile' ? 'unipile_id' : 'apollo_person_id'
      });
    }
  } catch (leadErr) {
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
