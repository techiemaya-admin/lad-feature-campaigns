/**
 * Cloud Tasks Client
 * 
 * Shared GCP Cloud Tasks integration for creating scheduled HTTP tasks
 * Multi-tenant safe, used for follow-up call scheduling
 */

const { CloudTasksClient } = require('@google-cloud/tasks');

let logger;
try {
  logger = require('../../core/utils/logger');
} catch (e) {
  // Fallback to console if logger not available
  logger = {
    info: (...args) => console.log('[CloudTasksClient INFO]', ...args),
    error: (...args) => console.error('[CloudTasksClient ERROR]', ...args),
    warn: (...args) => console.warn('[CloudTasksClient WARN]', ...args)
  };
}

class CloudTasksService {
  constructor() {
    this.client = null;
    this.projectId = process.env.GCP_PROJECT_ID;
    this.location = process.env.GCP_LOCATION || 'us-central1';
    this.serviceAccountEmail = process.env.GCP_CLOUD_TASKS_SERVICE_ACCOUNT;
    
    // Initialize client only if credentials are available
    if (this.projectId) {
      try {
        this.client = new CloudTasksClient();
      } catch (error) {
        logger.warn('Cloud Tasks client initialization failed:', error.message);
        this.client = null;
      }
    } else {
      logger.warn('GCP_PROJECT_ID not configured - Cloud Tasks disabled');
    }
  }

  /**
   * Create a scheduled HTTP task
   * 
   * @param {Object} params - Task parameters
   * @param {string} params.queue - Queue name (e.g., 'follow-up-calls')
   * @param {string} params.url - Target URL to call
   * @param {Object} params.payload - JSON payload to send
   * @param {Date|string} params.scheduleTime - When to execute (Date or ISO string)
   * @param {string} params.oidcServiceAccountEmail - Service account for OIDC token (optional)
   * @param {string} params.idempotencyKey - Unique task name for deduplication (optional)
   * @returns {Promise<Object>} Created task details
   */
  async createScheduledHttpTask({
    queue,
    url,
    payload,
    scheduleTime,
    oidcServiceAccountEmail,
    idempotencyKey = null
  }) {
    if (!this.client) {
      throw new Error('Cloud Tasks client not initialized - check GCP configuration');
    }

    if (!queue || !url || !payload) {
      throw new Error('queue, url, and payload are required');
    }

    // Convert scheduleTime to seconds since epoch
    const scheduleTimeDate = scheduleTime instanceof Date 
      ? scheduleTime 
      : new Date(scheduleTime);
    
    const scheduleTimeSeconds = Math.floor(scheduleTimeDate.getTime() / 1000);

    // Build queue path
    const parent = this.client.queuePath(this.projectId, this.location, queue);

    // Build task configuration
    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json'
        },
        body: Buffer.from(JSON.stringify(payload)).toString('base64')
      },
      scheduleTime: {
        seconds: scheduleTimeSeconds
      }
    };

    // Add OIDC authentication if service account provided
    const serviceAccount = oidcServiceAccountEmail || this.serviceAccountEmail;
    if (serviceAccount) {
      task.httpRequest.oidcToken = {
        serviceAccountEmail: serviceAccount,
        audience: url
      };
    }

    // Add task name for idempotency if provided
    if (idempotencyKey) {
      // Task name must be unique and follow GCP naming rules
      const sanitizedKey = idempotencyKey
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 500);
      task.name = `${parent}/tasks/${sanitizedKey}`;
    }

    try {
      const request = { parent, task };
      const [response] = await this.client.createTask(request);

      logger.info('Cloud Task created:', {
        taskName: response.name,
        queue,
        url,
        scheduleTime: scheduleTimeDate.toISOString()
      });

      return {
        success: true,
        taskName: response.name,
        scheduleTime: scheduleTimeDate.toISOString(),
        queue
      };
    } catch (error) {
      // Check if task already exists (6 = ALREADY_EXISTS)
      if (error.code === 6) {
        logger.warn('Task already exists:', {
          idempotencyKey,
          queue,
          url
        });
        
        return {
          success: true,
          taskName: task.name,
          alreadyExists: true,
          scheduleTime: scheduleTimeDate.toISOString(),
          queue
        };
      }

      logger.error('Cloud Task creation failed:', {
        error: error.message,
        code: error.code,
        queue,
        url,
        idempotencyKey
      });

      throw error;
    }
  }

  /**
   * Delete a task by name
   * 
   * @param {string} taskName - Full task name from Cloud Tasks
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async deleteTask(taskName) {
    if (!this.client) {
      throw new Error('Cloud Tasks client not initialized');
    }

    try {
      await this.client.deleteTask({ name: taskName });
      logger.info('Cloud Task deleted:', { taskName });
      return true;
    } catch (error) {
      // Task not found is not an error for deletion
      if (error.code === 5) { // NOT_FOUND
        logger.warn('Task not found for deletion:', { taskName });
        return true;
      }

      logger.error('Cloud Task deletion failed:', {
        error: error.message,
        taskName
      });
      throw error;
    }
  }

  /**
   * Check if Cloud Tasks is enabled
   * 
   * @returns {boolean} True if client is initialized
   */
  isEnabled() {
    return this.client !== null;
  }
}

// Export singleton instance
module.exports = new CloudTasksService();
