/**
 * Campaign Controller
 * Handles HTTP requests for campaigns
 */

const CampaignModel = require('../models/CampaignModel');
const CampaignStepModel = require('../models/CampaignStepModel');
const CampaignLeadModel = require('../models/CampaignLeadModel');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');

class CampaignController {
  /**
   * GET /api/campaigns
   * List all campaigns with stats
   */
  static async listCampaigns(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { search, status, limit, offset } = req.query;

      const campaigns = await CampaignModel.list(tenantId, {
        search,
        status,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0
      });

      // Fetch steps for each campaign
      const campaignsWithSteps = await Promise.all(
        campaigns.map(async (campaign) => {
          try {
            const steps = await CampaignStepModel.getStepsByCampaignId(campaign.id, tenantId);
            return {
              ...campaign,
              steps: steps || [],
              leads_count: parseInt(campaign.leads_count) || 0,
              sent_count: parseInt(campaign.sent_count) || 0,
              delivered_count: parseInt(campaign.delivered_count) || 0,
              connected_count: parseInt(campaign.connected_count) || 0,
              replied_count: parseInt(campaign.replied_count) || 0,
              opened_count: parseInt(campaign.opened_count) || 0,
              clicked_count: parseInt(campaign.clicked_count) || 0
            };
          } catch (error) {
            console.warn(`Could not fetch steps for campaign ${campaign.id}:`, error.message);
            return {
              ...campaign,
              steps: [],
              leads_count: parseInt(campaign.leads_count) || 0,
              sent_count: parseInt(campaign.sent_count) || 0,
              delivered_count: parseInt(campaign.delivered_count) || 0,
              connected_count: parseInt(campaign.connected_count) || 0,
              replied_count: parseInt(campaign.replied_count) || 0,
              opened_count: parseInt(campaign.opened_count) || 0,
              clicked_count: parseInt(campaign.clicked_count) || 0
            };
          }
        })
      );

      res.json({
        success: true,
        data: campaignsWithSteps
      });
    } catch (error) {
      console.error('[Campaign Controller] Error listing campaigns:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list campaigns',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/stats
   * Get campaign statistics
   */
  static async getCampaignStats(req, res) {
    try {
      const tenantId = req.user.tenantId;

      const stats = await CampaignModel.getStats(tenantId);

      res.json({
        success: true,
        data: {
          total_campaigns: parseInt(stats.total_campaigns) || 0,
          active_campaigns: parseInt(stats.active_campaigns) || 0,
          total_leads: parseInt(stats.total_leads) || 0,
          total_sent: parseInt(stats.total_sent) || 0,
          total_delivered: parseInt(stats.total_delivered) || 0,
          total_connected: parseInt(stats.total_connected) || 0,
          total_replied: parseInt(stats.total_replied) || 0
        }
      });
    } catch (error) {
      console.error('[Campaign Controller] Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign stats',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id
   * Get campaign by ID
   */
  static async getCampaignById(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      const campaign = await CampaignModel.getById(id, tenantId);

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      // Get steps
      const steps = await CampaignStepModel.getStepsByCampaignId(id, tenantId);

      // Get lead count
      const leads = await CampaignLeadModel.getByCampaignId(id, tenantId, { limit: 1 });

      res.json({
        success: true,
        data: {
          ...campaign,
          steps: steps || []
        }
      });
    } catch (error) {
      console.error('[Campaign Controller] Error getting campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns
   * Create a new campaign
   */
  static async createCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const userId = req.user.user_id || req.user.id;
      const { name, status, config, steps } = req.body;

      // Validate required fields
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Campaign name is required'
        });
      }

      // Create campaign
      const campaign = await CampaignModel.create({
        name,
        status: status || 'draft',
        createdBy: userId,
        config: config || {}
      }, tenantId);

      // Create steps if provided
      let createdSteps = [];
      if (steps && Array.isArray(steps) && steps.length > 0) {
        createdSteps = await CampaignStepModel.bulkCreate(campaign.id, tenantId, steps);
      }

      res.status(201).json({
        success: true,
        data: {
          ...campaign,
          steps: createdSteps
        }
      });
    } catch (error) {
      console.error('[Campaign Controller] Error creating campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create campaign',
        message: error.message
      });
    }
  }

  /**
   * PATCH /api/campaigns/:id
   * Update campaign
   */
  static async updateCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const updates = req.body;

      const campaign = await CampaignModel.update(id, tenantId, updates);

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      res.json({
        success: true,
        data: campaign
      });
    } catch (error) {
      console.error('[Campaign Controller] Error updating campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update campaign',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/campaigns/:id
   * Delete campaign (soft delete)
   */
  static async deleteCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      const result = await CampaignModel.delete(id, tenantId);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      res.json({
        success: true,
        message: 'Campaign deleted successfully'
      });
    } catch (error) {
      console.error('[Campaign Controller] Error deleting campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete campaign',
        message: error.message
      });
    }
  }

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
      console.error('[Campaign Controller] Error getting campaign leads:', error);
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
      console.error('[Campaign Controller] Error adding leads:', error);
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
      console.error('[Campaign Controller] Error getting activities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign activities',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/start
   * Start/resume a campaign
   */
  static async startCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      // Update campaign status to running
      const campaign = await CampaignModel.update(id, tenantId, { status: 'running' });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      // Trigger campaign execution
      CampaignExecutionService.processCampaign(id, tenantId).catch(err => {
        console.error(`[Campaign Controller] Error executing campaign ${id}:`, err);
      });

      res.json({
        success: true,
        message: 'Campaign started successfully',
        data: campaign
      });
    } catch (error) {
      console.error('[Campaign Controller] Error starting campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start campaign',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/pause
   * Pause a campaign
   */
  static async pauseCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      const campaign = await CampaignModel.update(id, tenantId, { status: 'paused' });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      res.json({
        success: true,
        message: 'Campaign paused successfully',
        data: campaign
      });
    } catch (error) {
      console.error('[Campaign Controller] Error pausing campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to pause campaign',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/stop
   * Stop a campaign
   */
  static async stopCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      const campaign = await CampaignModel.update(id, tenantId, { status: 'stopped' });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      res.json({
        success: true,
        message: 'Campaign stopped successfully',
        data: campaign
      });
    } catch (error) {
      console.error('[Campaign Controller] Error stopping campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to stop campaign',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id/steps
   * Get steps for a campaign
   */
  static async getCampaignSteps(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      const steps = await CampaignStepModel.getStepsByCampaignId(id, tenantId);

      res.json({
        success: true,
        data: steps
      });
    } catch (error) {
      console.error('[Campaign Controller] Error getting campaign steps:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign steps',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/steps
   * Add/update steps for a campaign
   */
  static async updateCampaignSteps(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { steps } = req.body;

      if (!steps || !Array.isArray(steps)) {
        return res.status(400).json({
          success: false,
          error: 'Steps array is required'
        });
      }

      // Delete existing steps
      await CampaignStepModel.deleteByCampaignId(id, tenantId);

      // Create new steps
      const createdSteps = await CampaignStepModel.bulkCreate(id, tenantId, steps);

      res.json({
        success: true,
        data: createdSteps
      });
    } catch (error) {
      console.error('[Campaign Controller] Error updating campaign steps:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update campaign steps',
        message: error.message
      });
    }
  }
}

module.exports = CampaignController;
