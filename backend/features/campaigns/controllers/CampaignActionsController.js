/**
 * Campaign Actions Controller
 * Handles campaign lifecycle actions (start, pause, stop)
 */
const CampaignModel = require('../models/CampaignModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');
const { campaignStatsTracker } = require('../services/campaignStatsTracker');
const { campaignEventsService } = require('../services/campaignEventsService');
const campaignDailyScheduler = require('../services/CampaignDailyScheduler');
const logger = require('../../../core/utils/logger');

class CampaignActionsController {
  /**
   * POST /api/campaigns/:id/start
   * Start/resume a campaign
   */
  static async startCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
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
      }
      // Trigger campaign execution IMMEDIATELY (fire and forget, but log errors)
      // This ensures leads are scraped right away when campaign is started
      // Extract auth token from request to pass to processCampaign
      // The token is available via req.headers.authorization (Bearer token)
      const authToken = req.headers.authorization 
        ? req.headers.authorization.replace('Bearer ', '').trim()
        : null;
      // IMPORTANT: Wrap in try-catch to catch synchronous errors
      try {
        CampaignExecutionService.processCampaign(id, tenantId, authToken)
          .then(async (result) => {
            // Emit SSE event so frontend updates in real-time
            try {
              const stats = await campaignStatsTracker.getStats(id);
              await campaignEventsService.publishCampaignListUpdate(id, stats);
              logger.info('Campaign started - SSE event published', {
                campaignId: id, 
                leads: stats.leads_count, 
                sent: stats.sent_count,
                connected: stats.connected_count 
              });
            } catch (sseError) {
              logger.error('Failed to publish SSE event', { error: sseError.message });
            }
          })
          .catch(err => {
            logger.error('Campaign processing failed in background', {
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
        logger.error('Synchronous error starting campaign', { error: syncError.message, campaignId: id });
      }

      // Check if campaign has start_date and end_date for Cloud Tasks scheduling
      if (campaign.campaign_start_date && campaign.campaign_end_date) {
        try {
          logger.info('[CampaignActions] Attempting to schedule Cloud Task', {
            campaignId: id,
            startDate: campaign.campaign_start_date,
            endDate: campaign.campaign_end_date,
            projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID,
            serviceUrl: process.env.CLOUD_RUN_SERVICE_URL || process.env.SERVICE_URL,
            queueName: process.env.CLOUD_TASKS_QUEUE_NAME
          });

          const taskInfo = await campaignDailyScheduler.scheduleInitialTask({
            id: campaign.id,
            tenant_id: campaign.tenant_id,
            campaign_start_date: campaign.campaign_start_date,
            campaign_end_date: campaign.campaign_end_date
          });
          
          logger.info('[CampaignActions] Cloud Task scheduled for daily execution', {
            campaignId: id,
            taskName: taskInfo.taskName,
            scheduleTime: taskInfo.scheduleTime
          });
        } catch (scheduleError) {
          logger.error('[CampaignActions] Failed to schedule Cloud Task', {
            campaignId: id,
            error: scheduleError.message,
            stack: scheduleError.stack,
            code: scheduleError.code
          });
          // Don't fail the start request if scheduling fails
        }
      } else {
        logger.info('[CampaignActions] Campaign started without Cloud Task scheduling', {
          campaignId: id,
          reason: 'No start_date or end_date configured',
          hasStartDate: !!campaign.campaign_start_date,
          hasEndDate: !!campaign.campaign_end_date
        });
      }

      res.json({
        success: true,
        message: 'Campaign started successfully',
        data: campaign
      });
    } catch (error) {
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
      res.status(500).json({
        success: false,
        error: 'Failed to stop campaign',
        message: error.message
      });
    }
  }
}
module.exports = CampaignActionsController;
