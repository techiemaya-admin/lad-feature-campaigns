/**
 * Campaign CRUD Controller
 * Handles basic CRUD operations for campaigns
 */
const CampaignModel = require('../models/CampaignModel');
const CampaignStepModel = require('../models/CampaignStepModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');
const { campaignStatsTracker } = require('../services/campaignStatsTracker');
const { campaignEventsService } = require('../services/campaignEventsService');
const { pool } = require('../../../shared/database/connection');
class CampaignCRUDController {
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
      // Fetch steps and real-time stats for each campaign
      const campaignsWithSteps = await Promise.all(
        campaigns.map(async (campaign) => {
          try {
            const steps = await CampaignStepModel.getStepsByCampaignId(campaign.id, tenantId);
            // Get real-time stats from campaign_analytics table
            let stats;
            try {
              stats = await campaignStatsTracker.getStats(campaign.id);
            } catch (statsError) {
              stats = {
                leads_count: parseInt(campaign.leads_count) || 0,
                sent_count: parseInt(campaign.sent_count) || 0,
                delivered_count: parseInt(campaign.delivered_count) || 0,
                connected_count: parseInt(campaign.connected_count) || 0,
                replied_count: parseInt(campaign.replied_count) || 0,
                opened_count: parseInt(campaign.opened_count) || 0,
                clicked_count: parseInt(campaign.clicked_count) || 0,
                platform_metrics: null
              };
            }
            return {
              ...campaign,
              steps: steps || [],
              ...stats
            };
          } catch (error) {
            return {
              ...campaign,
              steps: [],
              leads_count: parseInt(campaign.leads_count) || 0,
              sent_count: parseInt(campaign.sent_count) || 0,
              delivered_count: parseInt(campaign.delivered_count) || 0,
              connected_count: parseInt(campaign.connected_count) || 0,
              replied_count: parseInt(campaign.replied_count) || 0,
              opened_count: parseInt(campaign.opened_count) || 0,
              clicked_count: parseInt(campaign.clicked_count) || 0,
              platform_metrics: null
            };
          }
        })
      );

      res.json({
        success: true,
        data: campaignsWithSteps
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to list campaigns',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
      // Handle empty results from database (mock DB or no data)
      if (!stats) {
        return res.json({
          success: true,
          data: {
            total_campaigns: 0,
            active_campaigns: 0,
            total_leads: 0,
            total_sent: 0,
            total_delivered: 0,
            total_connected: 0,
            total_replied: 0
          }
        });
      }
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
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign stats',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
      res.json({
        success: true,
        data: {
          ...campaign,
          steps: steps || []
        }
      });
    } catch (error) {
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
    ;
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.userId || req.user?.user_id || req.user?.id;
      // Validate authentication
      if (!tenantId) {
        return res.status(401).json({
          success: false,
          error: 'Tenant ID is required. Please ensure you are authenticated.'
        });
      }
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'User ID is required. Please ensure you are authenticated.'
        });
      }
      const { name, status, config, steps, campaign_type, leads_per_day, inbound_lead_ids } = req.body;

      // Validate required fields
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Campaign name is required'
        });
      }
      // Store campaign_type in config
      const campaignConfig = config || {};
      if (campaign_type) {
        campaignConfig.campaign_type = campaign_type;
      }
      // Merge leads_per_day from top level if provided (for backwards compatibility)
      if (leads_per_day !== undefined) {
        campaignConfig.leads_per_day = leads_per_day;
      }
      // Map frontend status 'active' to database status 'running'
      // Frontend uses: draft, active, paused, completed, stopped
      // Database uses: draft, running, paused, completed, stopped
      const dbStatus = status === 'active' ? 'running' : (status || 'draft');
      // Create campaign
      const campaign = await CampaignModel.create({
        name,
        status: dbStatus,
        createdBy: userId,
        config: campaignConfig,
        inbound_lead_ids  // Pass inbound lead IDs to model
      }, tenantId);
      // Create steps if provided
      let createdSteps = [];
      if (steps && Array.isArray(steps) && steps.length > 0) {
        createdSteps = await CampaignStepModel.bulkCreate(campaign.id, tenantId, steps);
      }
      // NOTE: Inbound leads are already linked by CampaignModel.create() when inbound_lead_ids is passed
      // No need to link them again here to avoid duplicates
      // If campaign is created with status='running' (mapped from 'active'), trigger immediate lead generation
      // This ensures leads are scraped right away when campaign is created and started
      if (campaign.status === 'running' || status === 'active') {

        // Set execution_state to active for immediate processing
        try {
          await CampaignModel.updateExecutionState(campaign.id, 'active', {
            lastExecutionReason: 'Campaign created and started immediately'
          });
        } catch (stateError) {
          // If execution_state columns don't exist, continue anyway
        }
        // Extract auth token from request headers
        const authToken = req.headers.authorization 
          ? req.headers.authorization.replace('Bearer ', '').trim()
          : null;

        // Trigger campaign execution immediately (fire and forget)
        CampaignExecutionService.processCampaign(campaign.id, tenantId, authToken)
          .then(async (result) => {

            // ✅ ALWAYS emit SSE event after processCampaign completes (whether success, skipped, or error)
            // This ensures UI updates even if campaign was skipped or had no leads
            try {
              const stats = await campaignStatsTracker.getStats(campaign.id);
              await campaignEventsService.publishCampaignListUpdate(campaign.id, stats);

            } catch (sseError) {
            }
          })
          .catch(err => {

            // Even on error, try to emit SSE so UI shows current state
            campaignStatsTracker.getStats(campaign.id)
              .then(stats => {
                campaignEventsService.publishCampaignListUpdate(campaign.id, stats);
              })
              .catch(sseErr => {});
          });
      } else {
        // If campaign is NOT running, emit SSE immediately (no leads to wait for)
        try {
          const stats = await campaignStatsTracker.getStats(campaign.id);
          await campaignEventsService.publishCampaignListUpdate(campaign.id, stats);
        } catch (sseError) {
        }
      }
      // ✅ Remove the old SSE emission that was happening too early
      res.status(201).json({
        success: true,
        data: {
          ...campaign,
          campaign_type: campaignConfig.campaign_type || 'linkedin_outreach',
          steps: createdSteps
        }
      });
    } catch (error) {
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
      res.status(500).json({
        success: false,
        error: 'Failed to delete campaign',
        message: error.message
      });
    }
  }
}
module.exports = CampaignCRUDController;
