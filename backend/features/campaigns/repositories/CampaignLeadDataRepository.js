/**
 * Campaign Lead Data Repository
 * SQL queries only - no business logic
 * LAD Architecture Compliant
 */

const { pool } = require('../../../config/database');
const { getSchema } = require('../../../core/utils/schemaHelper');

class CampaignLeadDataRepository {
  /**
   * Get campaign lead data with lead_id
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  static async getLeadDataById(campaignLeadId, tenantId, req = null) {
    const schema = getSchema(req);
    
    try {
      const query = `
        SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
        FROM ${schema}.campaign_leads cl
        WHERE cl.id = $1 AND cl.tenant_id = $2 AND cl.is_deleted = FALSE
      `;
      const result = await pool.query(query, [campaignLeadId, tenantId]);
      return result.rows[0] || null;
    } catch (err) {
      // Fallback for schemas without is_deleted column
      if (err.message && err.message.includes('is_deleted')) {
        const query = `
          SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
          FROM ${schema}.campaign_leads cl
          WHERE cl.id = $1 AND cl.tenant_id = $2
        `;
        const result = await pool.query(query, [campaignLeadId, tenantId]);
        return result.rows[0] || null;
      }
      throw err;
    }
  }

  /**
   * Get campaign lead data without tenant (legacy support)
   * LAD Architecture: Less secure, only for backward compatibility
   */
  static async getLeadDataByIdLegacy(campaignLeadId, req = null) {
    const schema = getSchema(req);
    
    try {
      const query = `
        SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
        FROM ${schema}.campaign_leads cl
        WHERE cl.id = $1 AND cl.is_deleted = FALSE
      `;
      const result = await pool.query(query, [campaignLeadId]);
      return result.rows[0] || null;
    } catch (err) {
      if (err.message && err.message.includes('is_deleted')) {
        const query = `
          SELECT cl.lead_data, cl.snapshot, cl.tenant_id, cl.lead_id
          FROM ${schema}.campaign_leads cl
          WHERE cl.id = $1
        `;
        const result = await pool.query(query, [campaignLeadId]);
        return result.rows[0] || null;
      }
      throw err;
    }
  }

  /**
   * Get lead details from leads table
   * LAD Architecture: Tenant-scoped query
   */
  static async getLeadFromLeadsTable(leadId, tenantId, req = null) {
    const schema = getSchema(req);
    
    const query = `
      SELECT first_name, last_name, email, linkedin_url, company_name, title, phone 
      FROM ${schema}.leads 
      WHERE id = $1 AND tenant_id = $2
    `;
    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Get campaign lead activities
   * LAD Architecture: Tenant-scoped query
   */
  static async getActivitiesByLeadId(campaignLeadId, tenantId, req = null) {
    const schema = getSchema(req);
    
    const query = `
      SELECT status 
      FROM ${schema}.campaign_lead_activities 
      WHERE campaign_lead_id = $1 AND tenant_id = $2
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [campaignLeadId, tenantId]);
    return result.rows;
  }
}

module.exports = CampaignLeadDataRepository;
