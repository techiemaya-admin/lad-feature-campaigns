/**
 * Campaign Leads Controller
 * Handles lead management for campaigns
 * LAD Architecture Compliant - No SQL in controllers, uses logger instead of console
 */

const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');
const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../core/utils/schemaHelper');
const CampaignLeadActivityRepository = require('../repositories/CampaignLeadActivityRepository');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');
const logger = require('../../../core/utils/logger');

class CampaignLeadsController {
  /**
   * GET /api/campaigns/:id/leads
   * Get leads for a campaign
   */
  static async getCampaignLeads(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { status, limit, offset } = req.query;
      // LAD Architecture: Use repository layer instead of direct SQL in controller
      const dbLeads = await CampaignLeadRepository.getByCampaignId(id, tenantId, {
        status,
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0
      }, req);
      const leads = dbLeads.map(lead => CampaignLeadModel.mapLeadFromDB(lead));
      
      // Format leads for frontend
      const formattedLeads = leads.map(lead => {
        try {
          // Use mapped lead data
          const snapshot = lead.snapshot || {};
          const leadData = lead.leadData || {};
          
          // Extract profile summary from lead_data if it exists
          const profileSummary = leadData.profile_summary || null;
          
          // Extract apollo_person_id from lead_data (needed for reveal email/phone)
          const apolloPersonId = leadData.apollo_person_id || leadData.id || leadData.apollo_id || null;
          
          // Extract name fields - Priority: mapped fields > snapshot > lead_data
          const firstName = lead.firstName || snapshot.first_name || leadData.first_name || leadData.employee_name?.split(' ')[0] || '';
          const lastName = lead.lastName || snapshot.last_name || leadData.last_name || leadData.employee_name?.split(' ').slice(1).join(' ') || '';
          
          // Build full name
          let name = '';
          if (firstName && lastName) {
            name = `${firstName} ${lastName}`.trim();
          } else if (firstName) {
            name = firstName;
          } else if (lastName) {
            name = lastName;
          } else {
            name = leadData.name || leadData.employee_name || leadData.fullname || snapshot.name || 'Unknown';
          }
          
          return {
            id: lead.id,
            campaign_id: lead.campaign_id,
            lead_id: lead.lead_id,
            status: lead.status,
            name: name,
            first_name: firstName,
            last_name: lastName,
            email: lead.email || snapshot.email || leadData.email || leadData.employee_email || leadData.work_email || null,
            phone: lead.phone || snapshot.phone || leadData.phone || leadData.employee_phone || leadData.phone_number || null,
            company: lead.companyName || snapshot.company_name || leadData.company_name || leadData.company || leadData.employee_company || leadData.organization?.name || null,
            title: lead.title || snapshot.title || leadData.title || leadData.employee_title || leadData.job_title || leadData.headline || null,
            linkedin_url: lead.linkedinUrl || snapshot.linkedin_url || leadData.linkedin_url || leadData.employee_linkedin_url || leadData.linkedin || null,
            photo_url: leadData.photo_url || leadData.employee_photo_url || leadData.avatar || snapshot.photo_url || null,
            profile_summary: profileSummary,
            apollo_person_id: apolloPersonId, // Include apollo_person_id for reveal functionality
            created_at: lead.created_at,
            updated_at: lead.updated_at
          };
        } catch (formatError) {
          logger.error('[Campaign Leads] Error formatting lead', { error: formatError.message, stack: formatError.stack });
          // Return minimal data if formatting fails
          return {
            id: lead.id,
            campaign_id: lead.campaign_id,
            lead_id: lead.lead_id,
            status: lead.status,
            name: 'Unknown',
            first_name: null,
            last_name: null,
            email: null,
            phone: null,
            company: null,
            title: null,
            linkedin_url: null,
            photo_url: null,
            profile_summary: null,
            created_at: lead.created_at,
            updated_at: lead.updated_at
          };
        }
      });

      res.json({
        success: true,
        data: formattedLeads
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error getting campaign leads', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign leads',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/leads
   * Add leads to campaign
   */
  static async addLeadsToCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { leads } = req.body;

      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Leads array is required'
        });
      }

      const dbLeads = await CampaignLeadRepository.bulkCreate(id, tenantId, leads, req);
      const createdLeads = dbLeads.map(lead => CampaignLeadModel.mapLeadFromDB(lead));

      res.status(201).json({
        success: true,
        data: createdLeads
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error adding leads', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to add leads to campaign',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id/activities
   * Get activities for a campaign
   */
  static async getCampaignActivities(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { status, stepType, limit, offset } = req.query;

      const dbActivities = await CampaignLeadActivityRepository.getByCampaignId(id, tenantId, {
        status,
        stepType,
        limit: parseInt(limit) || 1000,
        offset: parseInt(offset) || 0
      }, req);
      const activities = dbActivities.map(activity => CampaignLeadActivityModel.mapActivityFromDB(activity));

      res.json({
        success: true,
        data: activities
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error getting activities', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign activities',
        message: error.message
      });
    }
  }
}

module.exports = CampaignLeadsController;

