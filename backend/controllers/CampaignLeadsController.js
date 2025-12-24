/**
 * Campaign Leads Controller
 * Handles lead management for campaigns
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');

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

      const leads = await CampaignLeadModel.getByCampaignId(id, tenantId, {
        status,
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0
      });

      res.json({
        success: true,
        data: leads
      });
    } catch (error) {
      console.error('[Campaign Leads] Error getting campaign leads:', error);
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

      const createdLeads = await CampaignLeadModel.bulkCreate(id, tenantId, leads);

      res.status(201).json({
        success: true,
        data: createdLeads
      });
    } catch (error) {
      console.error('[Campaign Leads] Error adding leads:', error);
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

      const activities = await CampaignLeadActivityModel.getByCampaignId(id, tenantId, {
        status,
        stepType,
        limit: parseInt(limit) || 1000,
        offset: parseInt(offset) || 0
      });

      res.json({
        success: true,
        data: activities
      });
    } catch (error) {
      console.error('[Campaign Leads] Error getting activities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign activities',
        message: error.message
      });
    }
  }
}

module.exports = CampaignLeadsController;

