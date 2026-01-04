/**
 * Lead Save Service
 * Handles saving leads to database (leads and campaign_leads tables)
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../../core/utils/schemaHelper');
const {
  checkLeadExists,
  extractLeadFields,
  createSnapshot,
  saveLeadToCampaign
} = require('./LeadGenerationHelpers');
const logger = require('../../../../core/utils/logger');

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
    const apolloPersonId = employee.id || employee.apollo_person_id || 'unknown';
    
    try {
      if (!apolloPersonId || apolloPersonId === 'unknown') {
        logger.warn('[Lead Save] Employee missing apollo_person_id, skipping', { employeeName: employee.name || employee.employee_name });
        continue;
      }
      
      // Check if lead already exists
      const existingLead = await checkLeadExists(campaignId, apolloPersonId);
      
      if (!existingLead) {
        // Ensure apollo_person_id is stored for future lookups
        const leadData = {
          ...employee,
          apollo_person_id: apolloPersonId
        };
        
        // Extract fields and create snapshot
        const fields = extractLeadFields(employee);
        const snapshot = createSnapshot(fields);
        
        // Find or create lead in leads table using apollo_person_id as source_id
        const leadId = await findOrCreateLead(tenantId, apolloPersonId, fields, leadData);
        
        // Save lead to campaign
        try {
          const insertedLeadId = await saveLeadToCampaign(campaignId, tenantId, leadId, snapshot, leadData);
          savedCount++;
          // Track first generated lead ID (primary key) for activity creation
          if (!firstGeneratedLeadId) {
            firstGeneratedLeadId = insertedLeadId;
          }
          logger.info('[Lead Save] Successfully saved lead to campaign', { apolloPersonId, campaignLeadId: insertedLeadId, leadId });
        } catch (err) {
          logger.error('[Lead Save] Error saving lead', {
            apolloPersonId,
            message: err.message,
            code: err.code,
            detail: err.detail,
            constraint: err.constraint
          });
          // Continue to next lead instead of throwing
        }
      } else {
        logger.info('[Lead Save] Skipping lead - already exists in campaign', { apolloPersonId, existingLeadId: existingLead.id });
      }
    } catch (err) {
      logger.error('[Lead Save] Error processing lead', {
        apolloPersonId,
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
 */
async function findOrCreateLead(tenantId, apolloPersonId, fields, leadData) {
  let leadId = null;
  
  try {
    // Find existing lead by source_id (Apollo person ID)
    const schema = getSchema({ user: { tenant_id: tenantId } });
    const findLeadResult = await pool.query(
      `SELECT id FROM ${schema}.leads 
       WHERE tenant_id = $1 AND source_id = $2 AND source = 'apollo_io'
       LIMIT 1`,
      [tenantId, apolloPersonId]
    );
    
    if (findLeadResult.rows.length > 0) {
      leadId = findLeadResult.rows[0].id;
      logger.info('[Lead Save] Found existing lead in leads table', { apolloPersonId, leadId });
    } else {
      // Create new lead with UUID id, store apollo_person_id in source_id
      const { randomUUID } = require('crypto');
      leadId = randomUUID();
      
      await pool.query(
        `INSERT INTO ${schema}.leads (
          id, tenant_id, source, source_id, 
          first_name, last_name, email, phone, 
          company_name, title, linkedin_url, 
          custom_fields, raw_data, created_at, updated_at
        )
        VALUES ($1, $2, 'apollo_io', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id, tenant_id) DO UPDATE SET
          source_id = EXCLUDED.source_id,
          custom_fields = EXCLUDED.custom_fields,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP`,
        [
          leadId,
          tenantId,
          apolloPersonId, // source_id - the real Apollo person ID
          fields.first_name || null,
          fields.last_name || null,
          fields.email || null,
          fields.phone || null,
          fields.company_name || null,
          fields.title || null,
          fields.linkedin_url || null,
          JSON.stringify({ apollo_person_id: apolloPersonId }), // custom_fields
          JSON.stringify(leadData) // raw_data - full employee data
        ]
      );
      logger.info('[Lead Save] Created new lead in leads table', { apolloPersonId, leadId, sourceId: apolloPersonId });
    }
  } catch (leadErr) {
    // If leads table doesn't exist or has different schema, generate UUID and continue
    if (leadErr.code === '42P01') {
      logger.warn('[Lead Save] leads table doesn\'t exist, generating UUID for lead_id', { apolloPersonId });
      const { randomUUID } = require('crypto');
      leadId = randomUUID();
    } else if (leadErr.code === '42703') {
      // Column doesn't exist, try without source_id
      logger.warn('[Lead Save] source_id column doesn\'t exist, creating lead without it', { apolloPersonId });
      try {
        const { randomUUID } = require('crypto');
        leadId = randomUUID();
        const schema = getSchema({ user: { tenant_id: tenantId } });
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
        logger.warn('[Lead Save] Could not create lead in leads table', { apolloPersonId, error: retryErr.message });
        const { randomUUID } = require('crypto');
        leadId = randomUUID();
      }
    } else {
      logger.warn('[Lead Save] Could not find/create lead in leads table', { apolloPersonId, error: leadErr.message });
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

