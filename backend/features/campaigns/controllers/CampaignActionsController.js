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
    console.log('[Campaign Actions] ========================================');
    console.log('[Campaign Actions] 🎯 startCampaign METHOD CALLED');
    console.log('[Campaign Actions] Request method:', req.method);
    console.log('[Campaign Actions] Request URL:', req.url);
    console.log('[Campaign Actions] Request originalUrl:', req.originalUrl);
    console.log('[Campaign Actions] Request params:', JSON.stringify(req.params, null, 2));
    console.log('[Campaign Actions] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[Campaign Actions] User object:', JSON.stringify(req.user, null, 2));
    console.log('[Campaign Actions] ========================================');
    
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      
      console.log('[Campaign Actions] Campaign ID from params:', id);
      console.log('[Campaign Actions] Tenant ID from user:', tenantId);

      // Update campaign status to running and reset execution_state to active
      // This ensures immediate lead generation when campaign is started
      const campaign = await CampaignModel.update(id, tenantId, { 
        status: 'running',
        execution_state: 'active' // Reset to active when manually started
      });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      // Also clear next_run_at and last_execution_reason when manually starting
      try {
        await CampaignModel.updateExecutionState(id, 'active', {
          nextRunAt: null,
          lastExecutionReason: 'Campaign manually started by user'
        });
      } catch (stateError) {
        // If execution_state columns don't exist, continue anyway
        console.warn('[Campaign Actions] Could not update execution state:', stateError.message);
      }

      // Trigger campaign execution IMMEDIATELY (fire and forget, but log errors)
      // This ensures leads are scraped right away when campaign is started
      console.log(`[Campaign Actions] 🚀 Triggering IMMEDIATE campaign execution for ${id} (tenant: ${tenantId || 'none'})`);
      console.log(`[Campaign Actions] ⏰ Start time: ${new Date().toISOString()}`);
      console.log(`[Campaign Actions] 📊 This will scrape leads immediately, not wait for scheduled service`);
      
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

