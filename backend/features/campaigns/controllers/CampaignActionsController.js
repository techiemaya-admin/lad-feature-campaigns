/**
 * Campaign Actions Controller
 * Handles campaign lifecycle actions (start, pause, stop)
 */

const CampaignModel = require('../models/CampaignModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');
const logger = require('../../../core/utils/logger');

class CampaignActionsController {
  /**
   * POST /api/campaigns/:id/start
   * Start/resume a campaign
   */
  static async startCampaign(req, res) {
    logger.debug('[Campaign Actions] startCampaign method called', { method: req.method, url: req.url, originalUrl: req.originalUrl, params: req.params, body: req.body, user: req.user });
    
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      
      logger.info('[Campaign Actions] Starting campaign', { campaignId: id, tenantId });

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
        logger.warn('[Campaign Actions] Could not update execution state', { error: stateError.message });
      }

      // Trigger campaign execution IMMEDIATELY (fire and forget, but log errors)
      // This ensures leads are scraped right away when campaign is started
      logger.info('[Campaign Actions] Triggering immediate campaign execution', { campaignId: id, tenantId, startTime: new Date().toISOString() });
      
      // Extract auth token from request to pass to processCampaign
      // The token is available via req.headers.authorization (Bearer token)
      const authToken = req.headers.authorization 
        ? req.headers.authorization.replace('Bearer ', '').trim()
        : null;
      
      logger.debug('[Campaign Actions] Auth token available', { hasToken: !!authToken });
      
      // IMPORTANT: Wrap in try-catch to catch synchronous errors
      try {
        CampaignExecutionService.processCampaign(id, tenantId, authToken)
          .then((result) => {
            logger.info('[Campaign Actions] Campaign processing completed', { campaignId: id, completedAt: new Date().toISOString(), result });
          })
          .catch(err => {
            logger.error('[Campaign Actions] Critical error executing campaign', {
              campaignId: id,
              error: err.message,
              name: err.name,
              code: err.code || 'N/A',
              stack: err.stack,
              responseStatus: err.response?.status,
              responseData: err.response?.data
            });
          });
      } catch (syncError) {
        logger.error('[Campaign Actions] Synchronous error when calling processCampaign', { error: syncError.message, stack: syncError.stack });
      }

      res.json({
        success: true,
        message: 'Campaign started successfully',
        data: campaign
      });
    } catch (error) {
      logger.error('[Campaign Actions] Error starting campaign', { error: error.message, stack: error.stack });
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
      logger.error('[Campaign Actions] Error pausing campaign', { error: error.message, stack: error.stack });
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
      logger.error('[Campaign Actions] Error stopping campaign', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to stop campaign',
        message: error.message
      });
    }
  }
}

module.exports = CampaignActionsController;

