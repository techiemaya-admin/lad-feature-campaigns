/**
 * Inbound Leads Controller
 * Handles saving uploaded leads to the leads table
 */
const { pool } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');
const InboundLeadsRepository = require('../repositories/InboundLeadsRepository');
const InboundLeadsService = require('../services/InboundLeadsService');
const InboundLeadsValidator = require('../validators/inboundLeadsValidator');

// Initialize repository and service
const inboundLeadsRepository = new InboundLeadsRepository(pool);
const inboundLeadsService = new InboundLeadsService(inboundLeadsRepository);

class InboundLeadsController {
  /**
   * Save inbound leads to leads table
   * POST /api/inbound-leads
   */
  static async saveInboundLeads(req, res) {
    try {
      const tenantId = req.user.tenantId || req.user.tenant_id;
      
      // Validate tenant_id
      if (!tenantId || !InboundLeadsValidator.validateTenantId(tenantId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tenant_id. Must be a valid UUID.'
        });
      }
      
      const { leads, skipDuplicates = false } = req.body;
      
      // Save leads using service (which handles duplicate detection)
      const result = await inboundLeadsService.saveBulkLeads(req, tenantId, leads, { skipDuplicates });
      
      // If duplicates found and not skipping, return for user review
      if (result.duplicatesFound) {
        return res.json({
          success: true,
          duplicatesFound: true,
          data: {
            duplicates: result.duplicates,
            duplicateCount: result.duplicateCount,
            newLeadsCount: result.newLeadsCount,
            totalUploaded: result.totalUploaded
          },
          message: `Found ${result.duplicateCount} duplicate lead(s). Please review and choose an action.`
        });
      }
      
      // Return success response
      res.json({
        success: true,
        duplicatesFound: false,
        data: {
          saved: result.saved,
          total: result.total,
          skippedDuplicates: result.skippedDuplicates,
          leads: result.leads,
          leadIds: result.leadIds,
          errors: result.errors
        },
        message: skipDuplicates 
          ? `Successfully saved ${result.saved} new leads. Skipped ${result.skippedDuplicates} duplicate(s).`
          : `Successfully saved ${result.saved} of ${result.total} leads`
      });
      
    } catch (error) {
      logger.error('[InboundLeadsController] Failed to save inbound leads:', {
        error: error.message,
        stack: error.stack
      });
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
      const tenantId = req.user.tenantId || req.user.tenant_id;
      
      // Validate tenant_id
      if (!tenantId || !InboundLeadsValidator.validateTenantId(tenantId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tenant_id. Must be a valid UUID.'
        });
      }
      
      const { limit = 50, offset = 0, search } = req.query;

      // Use service to get leads
      const leads = await inboundLeadsService.searchLeads(req, tenantId, {
        search,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        success: true,
        data: leads,
        total: leads.length
      });
      
    } catch (error) {
      logger.error('[InboundLeadsController] Failed to fetch inbound leads:', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch inbound leads'
      });
    }
  }

  /**
   * Cancel bookings for leads to re-nurture them
   * POST /api/inbound-leads/cancel-bookings
   */
  static async cancelBookingsForReNurturing(req, res) {
    try {
      const tenantId = req.user.tenantId || req.user.tenant_id;
      
      // Validate tenant_id
      if (!tenantId || !InboundLeadsValidator.validateTenantId(tenantId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tenant_id. Must be a valid UUID.'
        });
      }
      
      const { leadIds } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'leadIds array is required'
        });
      }
      
      // Cancel bookings using service
      const result = await inboundLeadsService.cancelLeadBookingsForReNurturing(
        req,
        tenantId,
        leadIds
      );
      
      res.json({
        success: true,
        data: {
          cancelledBookings: result.cancelledCount,
          leadIds: result.leadIds
        },
        message: `Cancelled ${result.cancelledCount} scheduled follow-up(s) for ${leadIds.length} lead(s). They will be re-nurtured as new leads.`
      });
      
    } catch (error) {
      logger.error('[InboundLeadsController] Failed to cancel bookings:', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to cancel bookings'
      });
    }
  }
}

module.exports = InboundLeadsController;
