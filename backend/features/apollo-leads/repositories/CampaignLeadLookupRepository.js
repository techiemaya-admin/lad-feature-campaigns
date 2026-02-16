/**
 * Campaign Lead Lookup Repository
 * LAD Architecture: SQL queries only - no business logic
 * 
 * Handles database operations for looking up Apollo person IDs from campaign leads.
 * This repository contains ONLY SQL queries.
 */

const { pool } = require('../../../shared/database/connection');

class CampaignLeadLookupRepository {
  /**
   * Get Apollo person ID from campaign lead UUID
   * LAD Architecture: SQL only, uses dynamic schema and tenant_id
   * 
   * @param {string} campaignLeadId - UUID of the campaign lead
   * @param {string} tenantId - Tenant ID for multi-tenancy
   * @param {string} schema - Schema name
   * @returns {Promise<{apollo_id: string, apollo_person_id: string}|null>}
   */
  async getApolloPersonIdFromCampaignLead(campaignLeadId, tenantId, schema) {
    const query = `
      SELECT 
        lead_data->>'id' as apollo_id, 
        lead_data->>'apollo_person_id' as apollo_person_id
      FROM ${schema}.campaign_leads
      WHERE id = $1 AND tenant_id = $2 AND is_deleted = FALSE
    `;
    
    const result = await pool.query(query, [campaignLeadId, tenantId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
}

module.exports = new CampaignLeadLookupRepository();
