/**
 * Campaign Daily Scheduler Service
 * Handles daily campaign execution and self-rescheduling
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const cloudTasksClient = require('../../../shared/services/cloudTasksClient');
const logger = require('../../../core/utils/logger');

class CampaignDailyScheduler {
  /**
   * Run daily campaign and schedule next task
   * Main entry point called by Cloud Tasks
   */
  async runDailyCampaign(campaignId, tenantId, scheduledFor) {
    const schema = getSchema();
    const currentDate = new Date();
    const scheduledDate = new Date(scheduledFor);

    logger.info('[CampaignDailyScheduler] Running daily campaign', {
      campaignId,
      tenantId,
      scheduledFor,
      currentDate: currentDate.toISOString(),
    });

    try {
      // 1. Get campaign with locking to prevent concurrent execution
      const campaign = await this.getCampaignForExecution(schema, campaignId, tenantId);

      if (!campaign) {
        logger.warn('[CampaignDailyScheduler] Campaign not found or not active', {
          campaignId,
          tenantId,
        });
        return {
          success: false,
          reason: 'campaign_not_found_or_inactive',
        };
      }

      // 2. Idempotency check - prevent running twice in same day
      const alreadyRanToday = this.hasRunToday(campaign.last_run_date, currentDate);
      if (alreadyRanToday) {
        logger.warn('[CampaignDailyScheduler] Campaign already ran today', {
          campaignId,
          tenantId,
          lastRunDate: campaign.last_run_date,
        });
        return {
          success: false,
          reason: 'already_ran_today',
          lastRunDate: campaign.last_run_date,
        };
      }

      // 3. Check if campaign should still run (within date range)
      if (!cloudTasksClient.shouldContinueScheduling(campaign, currentDate)) {
        logger.info('[CampaignDailyScheduler] Campaign scheduling ended', {
          campaignId,
          tenantId,
          status: campaign.status,
          endDate: campaign.end_date,
          currentDate: currentDate.toISOString(),
        });

        // Mark campaign as completed if past end date
        if (campaign.end_date && currentDate > new Date(campaign.end_date)) {
          await this.completeCampaign(schema, campaignId, tenantId);
        }

        return {
          success: false,
          reason: 'scheduling_ended',
        };
      }

      // 4. Execute campaign logic
      const executionResult = await this.executeCampaignWorkflow(campaign);

      // 5. Update last_run_date
      await this.updateLastRunDate(schema, campaignId, tenantId, currentDate);

      logger.info('[CampaignDailyScheduler] Campaign executed successfully', {
        campaignId,
        tenantId,
        executionResult,
      });

      // 6. Schedule next day task (self-rescheduling)
      const nextDayTime = cloudTasksClient.calculateNextDayTime(currentDate);
      
      if (cloudTasksClient.shouldContinueScheduling(campaign, nextDayTime)) {
        const taskInfo = await cloudTasksClient.scheduleNextDayTask(
          campaignId,
          tenantId,
          nextDayTime
        );

        logger.info('[CampaignDailyScheduler] Next task scheduled', {
          campaignId,
          tenantId,
          nextTaskTime: nextDayTime.toISOString(),
          taskName: taskInfo.taskName,
        });
      } else {
        logger.info('[CampaignDailyScheduler] No more tasks to schedule', {
          campaignId,
          tenantId,
          reason: 'end_date_reached',
        });
      }

      return {
        success: true,
        executedAt: currentDate.toISOString(),
        nextScheduledFor: nextDayTime.toISOString(),
        executionResult,
      };
    } catch (error) {
      logger.error('[CampaignDailyScheduler] Failed to run daily campaign', {
        campaignId,
        tenantId,
        error: error.message,
        stack: error.stack,
      });

      // Record failure
      await this.recordExecutionFailure(schema, campaignId, tenantId, error);

      throw error;
    }
  }

  /**
   * Get campaign with row-level lock (FOR UPDATE)
   */
  async getCampaignForExecution(schema, campaignId, tenantId) {
    const query = `
      SELECT *
      FROM ${schema}.campaigns
      WHERE id = $1 
        AND tenant_id = $2 
        AND is_deleted = FALSE
        AND (status = 'running' OR status = 'active')
      FOR UPDATE SKIP LOCKED
    `;

    const result = await pool.query(query, [campaignId, tenantId]);
    return result.rows[0];
  }

  /**
   * Check if campaign already ran today (idempotency)
   */
  hasRunToday(lastRunDate, currentDate) {
    if (!lastRunDate) return false;

    const lastRun = new Date(lastRunDate);
    const current = new Date(currentDate);

    return (
      lastRun.getFullYear() === current.getFullYear() &&
      lastRun.getMonth() === current.getMonth() &&
      lastRun.getDate() === current.getDate()
    );
  }

  /**
   * Execute campaign workflow
   * Integrates with CampaignProcessor for actual lead processing
   */
  async executeCampaignWorkflow(campaign) {
    logger.info('[CampaignDailyScheduler] Executing campaign workflow', {
      campaignId: campaign.id,
      campaignName: campaign.name,
    });

    try {
      // Use the actual CampaignProcessor to execute the campaign
      const CampaignProcessor = require('./CampaignProcessor');
      const result = await CampaignProcessor.processCampaign(campaign.id, campaign.tenant_id);
      
      return {
        success: result.success,
        leadCount: result.leadCount || 0,
        campaignId: result.campaignId,
      };
    } catch (error) {
      logger.error('[CampaignDailyScheduler] Campaign workflow execution failed', {
        campaignId: campaign.id,
        tenantId: campaign.tenant_id,
        error: error.message,
        stack: error.stack,
      });
      
      // Return failure but don't throw - let scheduler continue
      return {
        success: false,
        error: error.message,
        leadCount: 0,
      };
    }
  }

  /**
   * Update campaign last_run_date
   */
  async updateLastRunDate(schema, campaignId, tenantId, runDate) {
    const query = `
      UPDATE ${schema}.campaigns
      SET last_run_date = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 
        AND tenant_id = $3
      RETURNING last_run_date
    `;

    const result = await pool.query(query, [runDate, campaignId, tenantId]);
    
    logger.info('[CampaignDailyScheduler] Updated last_run_date', {
      campaignId,
      tenantId,
      lastRunDate: result.rows[0]?.last_run_date,
    });

    return result.rows[0];
  }

  /**
   * Mark campaign as completed (past end_date)
   */
  async completeCampaign(schema, campaignId, tenantId) {
    const query = `
      UPDATE ${schema}.campaigns
      SET status = 'completed',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 
        AND tenant_id = $2
      RETURNING status
    `;

    await pool.query(query, [campaignId, tenantId]);

    logger.info('[CampaignDailyScheduler] Campaign marked as completed', {
      campaignId,
      tenantId,
    });
  }

  /**
   * Record execution failure for monitoring
   */
  async recordExecutionFailure(schema, campaignId, tenantId, error) {
    try {
      const query = `
        INSERT INTO ${schema}.campaign_execution_log (
          campaign_id, tenant_id, execution_date, status, error_message, created_at
        ) VALUES ($1, $2, CURRENT_TIMESTAMP, 'failed', $3, CURRENT_TIMESTAMP)
      `;

      await pool.query(query, [campaignId, tenantId, error.message]);
    } catch (logError) {
      logger.error('[CampaignDailyScheduler] Failed to log execution error', {
        campaignId,
        tenantId,
        originalError: error.message,
        logError: logError.message,
      });
    }
  }

  /**
   * Schedule initial task when campaign is created
   */
  async scheduleInitialTask(campaign) {
    const { 
      id: campaignId, 
      tenant_id: tenantId, 
      campaign_start_date: startDate 
    } = campaign;

    if (!startDate) {
      logger.warn('[CampaignDailyScheduler] No start_date set, using current time', {
        campaignId,
        tenantId,
      });
    }

    const scheduleDate = startDate ? new Date(startDate) : new Date();

    return await cloudTasksClient.scheduleFirstTask(campaignId, tenantId, scheduleDate);
  }
}

module.exports = new CampaignDailyScheduler();
