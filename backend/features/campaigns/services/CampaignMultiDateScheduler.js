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

    for (let i = 0; i < scheduleDates.length; i++) {
      const scheduleDate = scheduleDates[i];
      
      try {
        const taskInfo = await cloudTasksClient.scheduleNextDayTask(
          campaignId,
          tenantId,
          scheduleDate,
          0 // retryCount
        );

        scheduledTasks.push({
          scheduleDate: scheduleDate.toISOString(),
          taskName: taskInfo.taskName,
          dayNumber: i + 1
        });

        logger.info('[CampaignSchedulingService] Task scheduled', {
          campaignId,
          tenantId,
          dayNumber: i + 1,
          scheduleDate: scheduleDate.toISOString(),
          taskName: taskInfo.taskName
        });
      } catch (error) {
        // Check if error is due to missing queue
        if (error.message.includes('does not exist') || error.message.includes('NOT_FOUND')) {
          queueMissing = true;
          logger.warn('[CampaignSchedulingService] Queue missing - stopping further attempts', {
            campaignId,
            tenantId,
            error: error.message
          });
        }
        
        logger.error('[CampaignSchedulingService] Failed to schedule task', {
          campaignId,
          tenantId,
          dayNumber: i + 1,
          scheduleDate: scheduleDate.toISOString(),
          error: error.message,
          isQueueMissing: queueMissing
        });

        failedTasks.push({
          scheduleDate: scheduleDate.toISOString(),
          dayNumber: i + 1,
          error: error.message
        });
        
        // If queue is missing, no point trying remaining tasks
        if (queueMissing) {
          // Add remaining dates to failed tasks
          for (let j = i + 1; j < scheduleDates.length; j++) {
            failedTasks.push({
              scheduleDate: scheduleDates[j].toISOString(),
              dayNumber: j + 1,
              error: 'Skipped due to missing queue'
            });
          }
          break;
        }
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
      campaignId,
      tenantId,
      ...result
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
