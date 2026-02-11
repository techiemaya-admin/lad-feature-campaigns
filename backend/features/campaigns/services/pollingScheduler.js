/**
 * LinkedIn Polling Scheduler
 * Initializes and manages scheduled polling jobs for LinkedIn connection acceptances
 * 
 * SCHEDULE:
 * - Runs 3 times per day: 11:00 AM, 2:00 PM, 5:00 PM (GST - Gulf Standard Time)
 * - Days: Monday - Friday only
 * - Each run checks last 24 hours for connection acceptances
 * - Automatically triggers follow-up messages for accepted connections
 * 
 * WHAT IT DOES:
 * 1. Polls Unipile API for accepted connections (last 24 hours)
 * 2. Matches accepted connections to CONNECTION_SENT records
 * 3. Records CONNECTION_ACCEPTED in campaign_analytics
 * 4. Finds MESSAGE_SKIPPED records for that lead
 * 5. Automatically sends the message and records as CONTACTED
 * 
 * WORKFLOW:
 * CONNECTION_SENT → (wait) → CONNECTION_ACCEPTED → CONTACTED
 * MESSAGE_SKIPPED → (triggered) → CONTACTED
 */

const cron = require('node-cron');
const linkedInPollingService = require('./LinkedInPollingService');
const logger = require('../../../core/utils/logger');
const { POLLING_SCHEDULE } = require('../constants/pollingConstants');

class PollingScheduler {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Start all scheduled polling jobs
   */
  start() {
    if (this.isRunning) {
      logger.warn('[PollingScheduler] Scheduler is already running');
      return;
    }

    logger.info('[PollingScheduler] Initializing LinkedIn polling scheduler');
    logger.info('[PollingScheduler] Schedule: 3 times daily (11 AM, 2 PM, 5 PM GST) on weekdays');

    // Schedule polling jobs according to POLLING_SCHEDULE
    const scheduleEntries = [
      { name: 'MORNING', cron: POLLING_SCHEDULE.MORNING, time: '11:00 AM' },
      { name: 'AFTERNOON', cron: POLLING_SCHEDULE.AFTERNOON, time: '2:00 PM' },
      { name: 'EVENING', cron: POLLING_SCHEDULE.EVENING, time: '5:00 PM' }
    ];

    scheduleEntries.forEach(({ name, cron: cronExpression, time }, index) => {
      const job = cron.schedule(cronExpression, async () => {
        try {
          logger.info(`[PollingScheduler] Running scheduled polling at ${time} GST`);
          
          await linkedInPollingService.pollAllLinkedInAccounts();
          
          logger.info(`[PollingScheduler] Polling completed successfully at ${time} GST`);
        } catch (error) {
          logger.error('[PollingScheduler] Polling job failed', {
            error: error.message,
            stack: error.stack,
            time: new Date().toISOString()
          });
        }
      }, {
        scheduled: true,
        timezone: 'Asia/Dubai' // GST timezone
      });

      this.jobs.push(job);
      logger.info(`[PollingScheduler] Job ${index + 1}/3 scheduled: ${name} at ${time} (${cronExpression})`);
    });

    this.isRunning = true;
    logger.info('[PollingScheduler] All polling jobs initialized and running');
    logger.info('[PollingScheduler] Next runs:');
    logger.info('  - 11:00 AM GST (Mon-Fri)');
    logger.info('  - 02:00 PM GST (Mon-Fri)');
    logger.info('  - 05:00 PM GST (Mon-Fri)');
  }

  /**
   * Stop all scheduled polling jobs
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('[PollingScheduler] Scheduler is not running');
      return;
    }

    logger.info('[PollingScheduler] Stopping all polling jobs');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    this.isRunning = false;
    logger.info('[PollingScheduler] All polling jobs stopped');
  }

  /**
   * Manually trigger polling (for testing or manual runs)
   */
  async triggerManualPoll() {
    logger.info('[PollingScheduler] Manual polling triggered');
    try {
      const result = await linkedInPollingService.pollAllLinkedInAccounts();
      logger.info('[PollingScheduler] Manual polling completed successfully', {
        total: result.total,
        successful: result.successful,
        failed: result.failed
      });
      return { 
        success: true, 
        message: 'Manual polling completed',
        result: result
      };
    } catch (error) {
      logger.error('[PollingScheduler] Manual polling failed', {
        error: error.message,
        stack: error.stack
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      jobCount: this.jobs.length,
      schedule: {
        morning: POLLING_SCHEDULE.MORNING,
        afternoon: POLLING_SCHEDULE.AFTERNOON,
        evening: POLLING_SCHEDULE.EVENING
      },
      times: ['11:00 AM GST', '02:00 PM GST', '05:00 PM GST'],
      days: 'Monday - Friday',
      timezone: 'Asia/Dubai (GST)',
      lookbackPeriod: '24 hours'
    };
  }
}

// Export singleton instance
const pollingScheduler = new PollingScheduler();
module.exports = { pollingScheduler };
