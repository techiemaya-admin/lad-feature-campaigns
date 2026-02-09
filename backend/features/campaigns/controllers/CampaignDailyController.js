/**
 * Campaign Daily Execution Controller
 * Handles Cloud Tasks HTTP callbacks for daily campaign runs
 */

const campaignDailyScheduler = require('../services/CampaignDailyScheduler');
const logger = require('../../../core/utils/logger');

class CampaignDailyController {
  /**
   * POST /api/campaigns/run-daily
   * Called by Cloud Tasks to run campaign daily
   */
  async runDaily(req, res) {
    try {
      // Validate Cloud Tasks authentication
      const taskName = req.headers['x-cloudtasks-taskname'];
      const queueName = req.headers['x-cloudtasks-queuename'];

      if (!taskName || !queueName) {
        logger.warn('[CampaignDailyController] Unauthorized access attempt to daily run endpoint', {
          ip: req.ip,
          headers: req.headers
        });

        return res.status(403).json({
          success: false,
          error: 'Forbidden - not authorized (Cloud Tasks only)'
        });
      }

      logger.info('[CampaignDailyController] Cloud Tasks request verified', {
        taskName,
        queueName
      });

      const { campaignId, tenantId, scheduledFor, retryCount = 0 } = req.body;

      // Validation
      if (!campaignId || !tenantId) {
        return res.status(400).json({
          success: false,
          error: 'campaignId and tenantId are required',
        });
      }

      logger.info('[CampaignDailyController] Received daily run request', {
        campaignId,
        tenantId,
        scheduledFor,
        retryCount,
        taskName,
        queueName
      });

      // Execute campaign
      const result = await campaignDailyScheduler.runDailyCampaign(
        campaignId,
        tenantId,
        scheduledFor
      );

      // Return success even if campaign didn't run (idempotency)
      // This prevents Cloud Tasks from retrying
      return res.status(200).json({
        success: true,
        ...result,
        retryCount,
      });
    } catch (error) {
      logger.error('[CampaignDailyController] Failed to run daily campaign', {
        campaignId: req.body?.campaignId,
        tenantId: req.body?.tenantId,
        error: error.message,
        stack: error.stack,
      });

      // Return 500 to trigger Cloud Tasks retry
      return res.status(500).json({
        success: false,
        error: error.message,
        retryable: true,
      });
    }
  }

  /**
   * POST /api/campaigns/:id/schedule-daily
   * Manually trigger daily scheduling for a campaign
   * (For testing or manual intervention)
   */
  async scheduleDaily(req, res) {
    try {
      const { id: campaignId } = req.params;
      const tenantId = req.user?.tenant_id || req.tenantId;

      if (!tenantId) {
        return res.status(401).json({
          success: false,
          error: 'Tenant ID not found',
        });
      }

      logger.info('[CampaignDailyController] Manual schedule request', {
        campaignId,
        tenantId,
        userId: req.user?.id,
      });

      // Get campaign
      const CampaignModel = require('../models/CampaignModel');
      const campaign = await CampaignModel.getById(campaignId, tenantId);

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found',
        });
      }

      // Schedule initial task
      const taskInfo = await campaignDailyScheduler.scheduleInitialTask(campaign);

      return res.status(200).json({
        success: true,
        message: 'Daily scheduling initiated',
        taskInfo,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
        },
      });
    } catch (error) {
      logger.error('[CampaignDailyController] Failed to schedule daily', {
        campaignId: req.params?.id,
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new CampaignDailyController();
