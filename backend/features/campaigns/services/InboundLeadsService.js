const { randomUUID } = require('crypto');
const logger = require('../../../core/utils/logger');
const InboundLeadsRepository = require('../repositories/InboundLeadsRepository');
const { transformUploadedLead, transformDuplicateResponse } = require('../dtos/inboundLeadDto');

/**
 * Service for inbound leads business logic
 */
class InboundLeadsService {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * Check for duplicate leads based on phone, email, or LinkedIn URL
   * @param {Object} req - Express request object
   * @param {string} tenantId - Tenant ID
   * @param {Array} leads - Array of lead data
   * @returns {Object} { duplicates, newLeads }
   */
  async checkForDuplicates(req, tenantId, leads) {
    const duplicateLeads = [];
    const newLeads = [];
    
    for (const leadData of leads) {
      const phone = leadData.phone || leadData.whatsapp;
      const email = leadData.email;
      const linkedinUrl = leadData.linkedinProfile;
      
      // Skip if no identifying information
      if (!phone && !email && !linkedinUrl) {
        newLeads.push(leadData);
        continue;
      }

      // Check for existing leads using repository
      const existingLeads = await this.repository.findDuplicateLeads(req, {
        tenantId,
        phone,
        email,
        linkedinUrl
      });
      
      if (existingLeads.length > 0) {
        // Found existing lead(s)
        const matchedOn = [];
        if (phone && existingLeads[0].phone === phone) matchedOn.push('phone');
        if (email && existingLeads[0].email === email) matchedOn.push('email');
        if (linkedinUrl && existingLeads[0].linkedin_url === linkedinUrl) matchedOn.push('linkedin_url');

        duplicateLeads.push({
          uploadedLead: leadData,
          existingLead: existingLeads[0],
          matchedOn,
          bookings: existingLeads[0].bookings || []
        });
      } else {
        newLeads.push(leadData);
      }
    }
    
    return { duplicateLeads, newLeads };
  }

  /**
   * Save bulk leads to database
   * @param {Object} req - Express request object
   * @param {string} tenantId - Tenant ID
   * @param {Array} leads - Array of lead data to save
   * @param {Object} options - Options like skipDuplicates
   * @returns {Object} Result with saved leads and errors
   */
  async saveBulkLeads(req, tenantId, leads, options = {}) {
    const { skipDuplicates = false } = options;
    
    // Check for duplicates
    const { duplicateLeads, newLeads } = await this.checkForDuplicates(req, tenantId, leads);
    
    // If duplicates found and not skipping, return for user review
    if (duplicateLeads.length > 0 && !skipDuplicates) {
      return {
        duplicatesFound: true,
        duplicates: duplicateLeads.map(transformDuplicateResponse),
        duplicateCount: duplicateLeads.length,
        newLeadsCount: newLeads.length,
        totalUploaded: leads.length
      };
    }

    // Process only new leads (or all if skipDuplicates is true)
    const leadsToSave = skipDuplicates ? newLeads : leads;
    const savedLeads = [];
    const errors = [];

    for (const leadData of leadsToSave) {
      try {
        // Transform lead data using DTO
        const transformedLead = transformUploadedLead(leadData, tenantId);
        
        // Save using repository
        const result = await this.repository.createLead(req, transformedLead);
        
        savedLeads.push({
          id: result.id,
          ...leadData
        });

      } catch (leadError) {
        logger.error('[InboundLeadsService] Failed to save individual lead:', {
          error: leadError.message,
          lead: leadData.companyName || leadData.email
        });
        errors.push({
          lead: leadData.companyName || leadData.email,
          error: leadError.message
        });
      }
    }
    
    return {
      duplicatesFound: false,
      saved: savedLeads.length,
      total: leadsToSave.length,
      skippedDuplicates: skipDuplicates ? duplicateLeads.length : 0,
      leads: savedLeads,
      leadIds: savedLeads.map(lead => lead.id),
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Search leads with pagination
   * @param {Object} req - Express request object
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Search filters
   * @returns {Array} Matching leads
   */
  async searchLeads(req, tenantId, filters) {
    return await this.repository.searchLeads(req, {
      tenantId,
      ...filters
    });
  }

  /**
   * Cancel all active bookings for leads and prepare for re-nurturing
   * @param {Object} req - Express request object
   * @param {string} tenantId - Tenant ID
   * @param {Array} leadIds - Array of lead IDs to cancel bookings for
   * @returns {Object} Result with cancelled count
   */
  async cancelLeadBookingsForReNurturing(req, tenantId, leadIds) {
    if (!leadIds || leadIds.length === 0) {
      return { cancelledCount: 0, leadIds: [] };
    }

    const result = await this.repository.cancelLeadBookings(req, {
      tenantId,
      leadIds
    });

    logger.info('[InboundLeadsService] Cancelled bookings for re-nurturing:', {
      tenantId,
      leadCount: leadIds.length,
      cancelledBookings: result.cancelledCount
    });

    return {
      cancelledCount: result.cancelledCount,
      leadIds
    };
  }
}

module.exports = InboundLeadsService;
