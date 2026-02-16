/**
 * Campaign Creation Example with Daily Scheduling
 * Production-ready flow for creating campaigns with Cloud Tasks scheduling
 */

const CampaignModel = require('../models/CampaignModel');
const campaignDailyScheduler = require('../services/CampaignDailyScheduler');
const logger = require('../../../core/utils/logger');

/**
 * Example: Create campaign with daily scheduling
 * Call this from your campaign creation endpoint
 */
async function createCampaignWithScheduling(campaignData, tenantId, userId) {
  try {
    // 1. Prepare campaign data
    const campaign = {
      name: campaignData.name,
      status: campaignData.status || 'draft',
      createdBy: userId,
      config: {
        ...campaignData.config,
        start_date: campaignData.start_date,
        end_date: campaignData.end_date,
        leads_per_day: campaignData.leads_per_day || 50,
      },
    };

    // 2. Create campaign in database
    const createdCampaign = await CampaignModel.create(campaign, tenantId);

    logger.info('[CampaignCreation] Campaign created', {
      campaignId: createdCampaign.id,
      tenantId,
      name: createdCampaign.name,
      status: createdCampaign.status,
    });

    // 3. If campaign has start_date and is active, schedule first task
    if (campaignData.start_date && createdCampaign.status === 'running') {
      const taskInfo = await campaignDailyScheduler.scheduleInitialTask({
        id: createdCampaign.id,
        tenant_id: tenantId,
        start_date: campaignData.start_date,
      });

      logger.info('[CampaignCreation] Initial task scheduled', {
        campaignId: createdCampaign.id,
        tenantId,
        taskInfo,
      });

      return {
        campaign: createdCampaign,
        scheduling: {
          enabled: true,
          firstRunAt: taskInfo.scheduleTime,
          taskName: taskInfo.taskName,
        },
      };
    }

    return {
      campaign: createdCampaign,
      scheduling: {
        enabled: false,
        reason: campaignData.start_date ? 'campaign_not_active' : 'no_start_date',
      },
    };
  } catch (error) {
    logger.error('[CampaignCreation] Failed to create campaign with scheduling', {
      tenantId,
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Example: Update existing campaign and trigger scheduling
 */
async function updateCampaignAndSchedule(campaignId, tenantId, updates) {
  try {
    // Update campaign
    const updatedCampaign = await CampaignModel.update(campaignId, tenantId, updates);

    // If status changed to 'running' and has start_date, schedule task
    if (updates.status === 'running' && updatedCampaign.config?.start_date) {
      const taskInfo = await campaignDailyScheduler.scheduleInitialTask({
        id: updatedCampaign.id,
        tenant_id: tenantId,
        start_date: updatedCampaign.config.start_date,
      });

      logger.info('[CampaignUpdate] Scheduled after status change', {
        campaignId,
        tenantId,
        taskInfo,
      });

      return {
        campaign: updatedCampaign,
        scheduled: true,
        taskInfo,
      };
    }

    return {
      campaign: updatedCampaign,
      scheduled: false,
    };
  } catch (error) {
    logger.error('[CampaignUpdate] Failed to update and schedule', {
      campaignId,
      tenantId,
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  createCampaignWithScheduling,
  updateCampaignAndSchedule,
};
