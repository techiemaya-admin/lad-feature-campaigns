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

      // Trigger campaign execution (fire and forget, but log errors)
      console.log(`[Campaign Actions] 🚀 Triggering campaign execution for ${id} (tenant: ${tenantId || 'none'})`);
      console.log(`[Campaign Actions] ⏰ Start time: ${new Date().toISOString()}`);
      
      // Extract auth token from request to pass to processCampaign
      // The token is available via req.headers.authorization (Bearer token)
      const authToken = req.headers.authorization 
        ? req.headers.authorization.replace('Bearer ', '').trim()
        : null;
      
      console.log(`[Campaign Actions] 🔑 Auth token available: ${authToken ? 'Yes' : 'No'}`);
      
      // IMPORTANT: Wrap in try-catch to catch synchronous errors
      try {
        CampaignExecutionService.processCampaign(id, tenantId, authToken)
          .then((result) => {
            console.log(`[Campaign Actions] ✅ Campaign ${id} processing completed at ${new Date().toISOString()}`);
            if (result) {
              console.log(`[Campaign Actions] Result:`, JSON.stringify(result, null, 2));
            }
          })
          .catch(err => {
            console.error(`[Campaign Actions] ❌ CRITICAL ERROR executing campaign ${id}:`);
            console.error(`[Campaign Actions] Error message: ${err.message}`);
            console.error(`[Campaign Actions] Error name: ${err.name}`);
            console.error(`[Campaign Actions] Error code: ${err.code || 'N/A'}`);
            console.error(`[Campaign Actions] Error stack:`, err.stack);
            if (err.response) {
              console.error(`[Campaign Actions] Error response:`, err.response.status, err.response.data);
            }
          });
      } catch (syncError) {
        console.error(`[Campaign Actions] ❌ SYNCHRONOUS ERROR when calling processCampaign:`, syncError);
        console.error(`[Campaign Actions] Sync error stack:`, syncError.stack);
      }

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

