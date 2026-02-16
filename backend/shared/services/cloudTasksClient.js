/**
 * Google Cloud Tasks Client
 * Production-ready helper for creating and managing Cloud Tasks
 */

const { CloudTasksClient } = require('@google-cloud/tasks');
const logger = require('../../core/utils/logger');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
const LOCATION = process.env.CLOUD_TASKS_LOCATION || 'us-central1';
const QUEUE_NAME = process.env.CLOUD_TASKS_QUEUE_NAME || 'campaign-scheduler-task';
const SERVICE_URL = process.env.CLOUD_RUN_SERVICE_URL || process.env.SERVICE_URL;
const SERVICE_ACCOUNT_EMAIL = process.env.GCP_SERVICE_ACCOUNT_EMAIL; // Will be auto-detected if not set
const IS_LOCAL_DEV = process.env.NODE_ENV === 'development' && SERVICE_URL?.includes('localhost');

class CloudTasksService {
  constructor() {
    try {
      // Initialize client with default credentials (Cloud Run service account)
      this.client = new CloudTasksClient();
      this.queuePath = this.client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
      this.isConfigured = true;
      this.queueExists = null; // Will be checked on first task creation
      
      if (IS_LOCAL_DEV) {
        logger.warn('[CloudTasks] Running in local development mode - tasks will be simulated');
      }
    } catch (error) {
      this.isConfigured = false;
      this.queueExists = false;
      logger.warn('[CloudTasks] Cloud Tasks client not initialized - running in simulation mode', {
        error: error.message,
        isLocalDev: IS_LOCAL_DEV
      });
    }
  }

  /**
   * Check if the queue exists in Cloud Tasks
   */
  async ensureQueueExists() {
    if (this.queueExists !== null) {
      return this.queueExists;
    }

    try {
      await this.client.getQueue({ name: this.queuePath });
      this.queueExists = true;
      logger.info('[CloudTasks] Queue exists', { queue: this.queuePath });
      return true;
    } catch (error) {
      this.queueExists = false;
      logger.error('[CloudTasks] Queue does not exist', {
        queue: this.queuePath,
        error: error.message,
        instructions: `Create queue: gcloud tasks queues create ${QUEUE_NAME} --location=${LOCATION} --project=${PROJECT_ID}`
      });
      return false;
    }
  }

  /**
   * Create HTTP task to run campaign daily
   * @param {string} campaignId - Campaign UUID
   * @param {string} tenantId - Tenant UUID
   * @param {Date} scheduleTime - When to run the task
   * @param {number} retryCount - Current retry attempt (for idempotency)
   * @returns {Promise<Object>} Created task
   */
  async scheduleNextDayTask(campaignId, tenantId, scheduleTime, retryCount = 0) {
    if (!PROJECT_ID) {
      throw new Error('GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID env var not set');
    }

    if (!SERVICE_URL) {
      throw new Error('CLOUD_RUN_SERVICE_URL or SERVICE_URL env var not set');
    }

    // In local development, simulate task creation
    if (IS_LOCAL_DEV || !this.isConfigured) {
      logger.info('[CloudTasks] SIMULATED task creation (local dev mode)', {
        campaignId,
        tenantId,
        scheduleTime: scheduleTime.toISOString(),
        queue: `${PROJECT_ID}/${LOCATION}/${QUEUE_NAME}`,
        url: `${SERVICE_URL}/api/campaigns/run-daily`,
        note: 'Task will be created in production Cloud Run environment'
      });

      return {
        taskName: `projects/${PROJECT_ID}/locations/${LOCATION}/queues/${QUEUE_NAME}/tasks/simulated-${campaignId}-${Date.now()}`,
        scheduleTime: scheduleTime.toISOString(),
        simulated: true
      };
    }

    // Check if queue exists before attempting to create task
    const queueExists = await this.ensureQueueExists();
    if (!queueExists) {
      const errorMsg = `Cloud Tasks queue '${QUEUE_NAME}' does not exist. Create it with: gcloud tasks queues create ${QUEUE_NAME} --location=${LOCATION} --project=${PROJECT_ID}`;
      logger.error('[CloudTasks] Cannot create task - queue missing', {
        campaignId,
        tenantId,
        queue: this.queuePath,
        queueName: QUEUE_NAME,
        location: LOCATION,
        projectId: PROJECT_ID
      });
      throw new Error(errorMsg);
    }

    const url = `${SERVICE_URL}/api/campaigns/run-daily`;
    
    const payload = {
      campaignId,
      tenantId,
      scheduledFor: scheduleTime.toISOString(),
      retryCount
    };

    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-CloudTasks-Secret': process.env.CLOUD_TASKS_SECRET || ''
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };

    // Add OIDC token for Cloud Run authentication
    // Service account must have cloudtasks.enqueuer role
    if (SERVICE_ACCOUNT_EMAIL) {
      task.httpRequest.oidcToken = {
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
      };
    }

    // Schedule task for specific time
    if (scheduleTime) {
      const scheduleTimeSeconds = Math.floor(scheduleTime.getTime() / 1000);
      task.scheduleTime = {
        seconds: scheduleTimeSeconds,
      };
    }

    try {
      const [response] = await this.client.createTask({
        parent: this.queuePath,
        task,
      });

      logger.info('[CloudTasks] Task scheduled', {
        campaignId,
        tenantId,
        taskName: response.name,
        scheduleTime: scheduleTime.toISOString(),
      });

      return {
        taskName: response.name,
        scheduleTime: scheduleTime.toISOString(),
      };
    } catch (error) {
      logger.error('[CloudTasks] Failed to create task', {
        campaignId,
        tenantId,
        error: error.message,
        queue: this.queuePath,
      });
      throw error;
    }
  }

  /**
   * Schedule first task for campaign (at start_date)
   * @param {string} campaignId 
   * @param {string} tenantId 
   * @param {Date} startDate 
   */
  async scheduleFirstTask(campaignId, tenantId, startDate) {
    const now = new Date();
    const scheduleTime = startDate > now ? startDate : now;

    logger.info('[CloudTasks] Scheduling first campaign task', {
      campaignId,
      tenantId,
      startDate: startDate.toISOString(),
      scheduleTime: scheduleTime.toISOString(),
    });

    return this.scheduleNextDayTask(campaignId, tenantId, scheduleTime, 0);
  }

  /**
   * Calculate next day schedule time (same time next day)
   * @param {Date} currentDate 
   * @returns {Date}
   */
  calculateNextDayTime(currentDate = new Date()) {
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay;
  }

  /**
   * Check if campaign should continue scheduling
   * @param {Object} campaign 
   * @param {Date} currentDate 
   * @returns {boolean}
   */
  shouldContinueScheduling(campaign, currentDate = new Date()) {
    if (!campaign) return false;
    if (campaign.status !== 'running' && campaign.status !== 'active') return false;
    if (!campaign.end_date) return true; // No end date, continue indefinitely
    
    const endDate = new Date(campaign.end_date);
    return currentDate <= endDate;
  }
}

module.exports = new CloudTasksService();
