/**
 * Campaign Actions Controller
 * Handles campaign lifecycle actions (start, pause, stop)
 */

const CampaignModel = require('../models/CampaignModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');

class CampaignActionsController {
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
        console.error(`[Campaign Actions] Error executing campaign ${id}:`, err);
      });

      res.json({
        success: true,
        message: 'Campaign started successfully',
        data: campaign
      });
    } catch (error) {
      console.error('[Campaign Actions] Error starting campaign:', error);
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
      console.error('[Campaign Actions] Error pausing campaign:', error);
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
      console.error('[Campaign Actions] Error stopping campaign:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to stop campaign',
        message: error.message
      });
    }
  }
}

module.exports = CampaignActionsController;

