/**
 * Campaign Multi-Date Scheduler Service
 * Business logic for scheduling multiple Cloud Tasks for campaigns
 * LAD Architecture: Service layer - orchestrates cloud tasks scheduling
 */

const cloudTasksClient = require('../../../shared/services/cloudTasksClient');
const logger = require('../../../core/utils/logger');

class CampaignSchedulingService {
  /**
   * Schedule Cloud Tasks for all campaign dates
   * @param {string} campaignId - Campaign UUID
   * @param {string} tenantId - Tenant UUID
   * @param {Date[]} scheduleDates - Array of dates to schedule tasks
   * @returns {Promise<Object>} Result with scheduled tasks info
   */
  static async scheduleTasksForDates(campaignId, tenantId, scheduleDates) {
    // Validate inputs
    if (!campaignId) {
      throw new Error('Campaign ID required');
    }
    if (!tenantId) {
      throw new Error('Tenant ID required');
    }
    if (!scheduleDates || scheduleDates.length === 0) {
      throw new Error('No schedule dates provided for campaign tasks');
    }

    logger.info('[CampaignSchedulingService] Scheduling tasks for campaign', {
      campaignId,
      tenantId,
      totalDates: scheduleDates.length,
      firstDate: scheduleDates[0].toISOString(),
      lastDate: scheduleDates[scheduleDates.length - 1].toISOString()
    });

    const scheduledTasks = [];
    const failedTasks = [];
    let queueMissing = false;

    // ✅ Process tasks in parallel batches of 10 — much faster for long campaigns
    // Sequential: 90 days × ~300ms per API call = 27 seconds to create
    // Batched (10 parallel at a time): ~3 seconds total
    const BATCH_SIZE = 10;

    for (let batchStart = 0; batchStart < scheduleDates.length; batchStart += BATCH_SIZE) {
      if (queueMissing) break;

      const batch = scheduleDates.slice(batchStart, batchStart + BATCH_SIZE);

      // Run batch in parallel with Promise.allSettled so one failure doesn't cancel others
      const batchResults = await Promise.allSettled(
        batch.map((scheduleDate, batchIndex) => {
          const dayNumber = batchStart + batchIndex + 1;
          return cloudTasksClient.scheduleNextDayTask(campaignId, tenantId, scheduleDate, 0)
            .then(taskInfo => ({ success: true, scheduleDate, taskName: taskInfo.taskName, dayNumber }))
            .catch(error => ({ success: false, scheduleDate, error: error.message, dayNumber }));
        })
      );

      for (const settled of batchResults) {
        // allSettled always fulfills; our inner .catch() handles errors as values
        const val = settled.value;
        if (val.success) {
          scheduledTasks.push({
            scheduleDate: val.scheduleDate.toISOString(),
            taskName: val.taskName,
            dayNumber: val.dayNumber
          });
          logger.info('[CampaignSchedulingService] Task scheduled', {
            campaignId, tenantId,
            dayNumber: val.dayNumber,
            scheduleDate: val.scheduleDate.toISOString(),
            taskName: val.taskName
          });
        } else {
          if (val.error.includes('does not exist') || val.error.includes('NOT_FOUND')) {
            queueMissing = true;
            logger.warn('[CampaignSchedulingService] Queue missing - stopping further batches', {
              campaignId, tenantId, error: val.error
            });
          }
          failedTasks.push({
            scheduleDate: val.scheduleDate.toISOString(),
            dayNumber: val.dayNumber,
            error: val.error
          });
          logger.error('[CampaignSchedulingService] Failed to schedule task', {
            campaignId, tenantId, dayNumber: val.dayNumber,
            scheduleDate: val.scheduleDate.toISOString(), error: val.error
          });
        }
      }

      // If queue is missing, mark all remaining un-attempted dates as failed
      if (queueMissing) {
        for (let j = batchStart + BATCH_SIZE; j < scheduleDates.length; j++) {
          failedTasks.push({
            scheduleDate: scheduleDates[j].toISOString(),
            dayNumber: j + 1,
            error: 'Skipped due to missing queue'
          });
        }
        break;
      }

      // 100ms pause between batches to avoid Cloud Tasks API rate limits
      if (batchStart + BATCH_SIZE < scheduleDates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const result = {
      success: failedTasks.length === 0,
      totalScheduled: scheduledTasks.length,
      totalFailed: failedTasks.length,
      scheduledTasks,
      failedTasks
    };

    logger.info('[CampaignSchedulingService] Scheduling completed', {
      campaignId, tenantId, ...result
    });

    return result;
  }

  /**
   * Schedule first task immediately and remaining tasks for future dates
   * @param {string} campaignId - Campaign UUID
   * @param {string} tenantId - Tenant UUID
   * @param {Date[]} scheduleDates - Array of dates to schedule tasks
   * @returns {Promise<Object>} Result with scheduled tasks info
   */
  static async scheduleWithImmediateFirstTask(campaignId, tenantId, scheduleDates) {
    // Validate inputs
    if (!campaignId) {
      throw new Error('Campaign ID required');
    }
    if (!tenantId) {
      throw new Error('Tenant ID required');
    }
    if (!scheduleDates || scheduleDates.length === 0) {
      throw new Error('No schedule dates provided for campaign tasks');
    }

    logger.info('[CampaignSchedulingService] Scheduling with immediate first task', {
      campaignId,
      tenantId,
      totalDates: scheduleDates.length
    });

    // Schedule first task immediately (or at first date if in future)
    const now = new Date();
    const firstTaskDate = scheduleDates[0] > now ? scheduleDates[0] : now;

    try {
      const firstTaskInfo = await cloudTasksClient.scheduleFirstTask(
        campaignId,
        tenantId,
        firstTaskDate
      );

      logger.info('[CampaignSchedulingService] First task scheduled', {
        campaignId,
        tenantId,
        scheduleDate: firstTaskDate.toISOString(),
        taskName: firstTaskInfo.taskName
      });
    } catch (error) {
      logger.error('[CampaignSchedulingService] Failed to schedule first task', {
        campaignId,
        tenantId,
        error: error.message
      });
      throw error;
    }

    // Schedule remaining tasks
    if (scheduleDates.length > 1) {
      const remainingDates = scheduleDates.slice(1);
      return await this.scheduleTasksForDates(campaignId, tenantId, remainingDates);
    }

    return {
      success: true,
      totalScheduled: 1,
      totalFailed: 0,
      scheduledTasks: [{
        scheduleDate: firstTaskDate.toISOString(),
        dayNumber: 1
      }],
      failedTasks: []
    };
  }
}

module.exports = CampaignSchedulingService;
