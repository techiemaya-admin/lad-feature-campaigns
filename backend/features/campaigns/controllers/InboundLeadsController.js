/**
 * Inbound Leads Controller
 * Handles saving uploaded leads to the leads table
 */
const { pool } = require('../../../shared/database/connection');
const { randomUUID } = require('crypto');
const logger = require('../../../core/utils/logger');

class InboundLeadsController {
  /**
   * Save inbound leads to leads table
   * POST /api/inbound-leads
   */
  static async saveInboundLeads(req, res) {
    try {
      const tenantId = req.user.tenantId || req.user.tenant_id;
      // Validate tenant_id is a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!tenantId || !uuidRegex.test(tenantId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tenant_id. Must be a valid UUID.'
        });
      }
      const { leads } = req.body; // Array of lead objects
      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No leads provided'
        });
      }
      // Use schemaHelper for production compatibility
      const schema = process.env.DB_SCHEMA || 'lad_dev';
      const savedLeads = [];
      const errors = [];

      for (const leadData of leads) {
        try {
          // Generate lead ID
          const leadId = randomUUID();
          // Use firstName and lastName if provided, otherwise parse from name or companyName
          let firstName = leadData.firstName || '';
          let lastName = leadData.lastName || '';
          // Fallback: Parse name if firstName/lastName not provided
          if (!firstName && !lastName) {
            const name = leadData.name || '';
            if (name) {
              const nameParts = name.split(' ');
              firstName = nameParts[0] || '';
              lastName = nameParts.slice(1).join(' ') || '';
            }
          }
          // Insert into leads table
          const result = await pool.query(
            `INSERT INTO ${schema}.leads (
              id, 
              tenant_id, 
              source, 
              source_id,
              first_name, 
              last_name, 
              email, 
              phone, 
              company_name, 
              title, 
              linkedin_url,
              custom_fields,
              raw_data,
              created_at, 
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (id, tenant_id) DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              email = EXCLUDED.email,
              phone = EXCLUDED.phone,
              company_name = EXCLUDED.company_name,
              linkedin_url = EXCLUDED.linkedin_url,
              custom_fields = EXCLUDED.custom_fields,
              raw_data = EXCLUDED.raw_data,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id`,
            [
              leadId,
              tenantId,
              'inbound_upload', // Source identifier
              leadId, // Use same ID as source_id for uploaded leads
              firstName || null,
              lastName || null,
              leadData.email || null,
              leadData.phone || leadData.whatsapp || null,
              leadData.companyName || null,
              leadData.title || null,
              leadData.linkedinProfile || null,
              JSON.stringify({
                whatsapp: leadData.whatsapp,
                website: leadData.website,
                notes: leadData.notes
              }),
              JSON.stringify(leadData) // Store full data
            ]
          );
          savedLeads.push({
            id: result.rows[0].id,
            ...leadData
          });

        } catch (leadError) {

          errors.push({
            lead: leadData.companyName || leadData.email,
            error: leadError.message
          });
        }
      }
      res.json({
        success: true,
        data: {
          saved: savedLeads.length,
          total: leads.length,
          leads: savedLeads,
          leadIds: savedLeads.map(lead => lead.id), // Extract just the IDs for easy reference
          errors: errors.length > 0 ? errors : undefined
        },
        message: `Successfully saved ${savedLeads.length} of ${leads.length} leads`
      });
    } catch (error) {

      res.status(500).json({
        success: false,
        error: 'Failed to save inbound leads',
        message: error.message
      });
    }
  }
  /**
   * Get all inbound leads for tenant
   * GET /api/inbound-leads
   */
  static async getInboundLeads(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { limit = 50, offset = 0, search } = req.query;
      // Use schemaHelper for production compatibility
      const schema = process.env.DB_SCHEMA || 'lad_dev';
      let query = `
        SELECT 
          id, 
          source, 
          source_id,
          first_name, 
          last_name, 
          email, 
          phone, 
          company_name, 
          title, 
          linkedin_url,
          custom_fields,
          created_at, 
          updated_at
        FROM ${schema}.leads 
        WHERE tenant_id = $1 
          AND source = 'inbound_upload'
      `;
      const params = [tenantId];
      if (search) {
        query += ` AND (
          first_name ILIKE $${params.length + 1} OR 
          last_name ILIKE $${params.length + 1} OR 
          email ILIKE $${params.length + 1} OR 
          company_name ILIKE $${params.length + 1}
        )`;
        params.push(`%${search}%`);
      }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(parseInt(limit), parseInt(offset));
      const result = await pool.query(query, params);
      res.json({
        success: true,
        data: result.rows,
        total: result.rows.length
      });
    } catch (error) {

      res.status(500).json({
        success: false,
        error: 'Failed to fetch inbound leads'
      });
    }
  }
}
module.exports = InboundLeadsController;
