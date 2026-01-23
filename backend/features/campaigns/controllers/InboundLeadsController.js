/**
 * Inbound Leads Controller
 * Handles saving uploaded leads to the leads table
 */
const { pool } = require('../../../shared/database/connection');
const { randomUUID } = require('crypto');
const logger = require('../../../core/utils/logger');
const { getSchema } = require('../../../core/utils/schemaHelper');
const InboundLeadsRepository = require('../repositories/InboundLeadsRepository');

// Initialize repository
const inboundLeadsRepository = new InboundLeadsRepository(pool);

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

      const savedLeads = [];
      const errors = [];

      for (const leadData of leads) {
        try {
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

          // Use repository to create lead
          const result = await inboundLeadsRepository.createLead(req, {
            tenantId,
            source: 'inbound_upload',
            sourceId: randomUUID(),
            firstName: firstName || null,
            lastName: lastName || null,
            email: leadData.email || null,
            phone: leadData.phone || leadData.whatsapp || null,
            companyName: leadData.companyName || null,
            title: leadData.title || null,
            linkedinUrl: leadData.linkedinProfile || null,
            customFields: JSON.stringify({
              whatsapp: leadData.whatsapp,
              website: leadData.website,
              notes: leadData.notes
            }),
            rawData: JSON.stringify(leadData)
          });

          savedLeads.push({
            id: result.id,
            ...leadData
          });

        } catch (leadError) {
          logger.error('Failed to save individual lead:', leadError);
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
      logger.error('Failed to save inbound leads:', error);
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

      // Use repository to get leads
      const leads = await inboundLeadsRepository.searchLeads(req, {
        tenantId,
        search,
        limit,
        offset
      });

      res.json({
        success: true,
        data: leads,
        total: leads.length
      });
    } catch (error) {
      logger.error('Failed to fetch inbound leads:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch inbound leads'
      });
    }
  }
}
module.exports = InboundLeadsController;
