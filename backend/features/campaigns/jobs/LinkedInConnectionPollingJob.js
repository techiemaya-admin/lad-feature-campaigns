/**
 * LinkedIn Connection Polling Job
 * Polls Unipile API 3 times per day to check invitation status
 * Scheduled via node-cron: 8 AM, 2 PM, 8 PM daily
 */

const cron = require('node-cron');
const logger = require('../../../core/utils/logger');
const UnipileConnectionTrackingService = require('../services/UnipileConnectionTrackingService');
const { pool } = require('../../../shared/database/connection');

class LinkedInConnectionPollingJob {
  /**
   * Start the polling job
   */
  static start() {
    // Schedule: 3 times per day (8 AM, 2 PM, 8 PM)
    // Cron format: minute hour day month weekday
    // 0 8,14,20 * * * = At 8:00 AM, 2:00 PM, and 8:00 PM every day
    
    const schedule = '0 8,14,20 * * *';

    cron.schedule(schedule, async () => {
      logger.info('[LinkedIn Connection Polling Job] Starting scheduled poll');
      
      try {
        await this.pollAllTenants();
      } catch (error) {
        logger.error('[LinkedIn Connection Polling Job] Job failed', {
          error: error.message,
          stack: error.stack
        });
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'America/New_York' // Configurable timezone
    });

    logger.info('[LinkedIn Connection Polling Job] Job scheduled', {
      schedule: '8 AM, 2 PM, 8 PM daily',
      timezone: process.env.TZ || 'America/New_York'
    });

    // Optional: Run immediately on startup for testing
    if (process.env.RUN_POLL_ON_STARTUP === 'true') {
      logger.info('[LinkedIn Connection Polling Job] Running initial poll on startup');
      this.pollAllTenants().catch(err => {
        logger.error('[LinkedIn Connection Polling Job] Startup poll failed', {
          error: err.message
        });
      });
    }
  }

  /**
   * Poll all tenants that have active campaigns
   */
  static async pollAllTenants() {
    try {
      // Get all tenants with active campaigns that have LinkedIn integration
      const query = `
        SELECT DISTINCT c.tenant_id
        FROM lad_dev.campaigns c
        INNER JOIN lad_dev.linkedin_accounts la 
          ON la.tenant_id = c.tenant_id AND la.status = 'active'
        WHERE c.status IN ('active', 'running', 'paused')
          AND c.deleted_at IS NULL
      `;

      const result = await pool.query(query);
      const tenants = result.rows;

      logger.info('[LinkedIn Connection Polling Job] Found tenants to poll', {
        count: tenants.length
      });

      const results = {
        totalTenants: tenants.length,
        successful: 0,
        failed: 0,
        errors: []
      };

      // Poll each tenant sequentially to avoid overloading Unipile API
      for (const tenant of tenants) {
        try {
          const pollResult = await UnipileConnectionTrackingService.pollInvitationStatus(
            tenant.tenant_id
          );

          results.successful++;

          logger.info('[LinkedIn Connection Polling Job] Tenant poll completed', {
            tenantId: tenant.tenant_id.substring(0, 8) + '...',
            stats: pollResult.stats
          });

        } catch (tenantError) {
          results.failed++;
          results.errors.push({
            tenantId: tenant.tenant_id.substring(0, 8) + '...',
            error: tenantError.message
          });

          logger.error('[LinkedIn Connection Polling Job] Tenant poll failed', {
            tenantId: tenant.tenant_id.substring(0, 8) + '...',
            error: tenantError.message
          });
        }

        // Add delay between tenants to respect rate limits
        await this._delay(2000); // 2 seconds delay
      }

      logger.info('[LinkedIn Connection Polling Job] All tenants polled', results);

      return results;

    } catch (error) {
      logger.error('[LinkedIn Connection Polling Job] Failed to get tenants', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Utility: Delay helper
   * @private
   */
  static _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger (for testing or admin action)
   */
  static async triggerManual(tenantId = null) {
    logger.info('[LinkedIn Connection Polling Job] Manual trigger', {
      tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'ALL'
    });

    if (tenantId) {
      // Poll specific tenant
      return await UnipileConnectionTrackingService.pollInvitationStatus(tenantId);
    } else {
      // Poll all tenants
      return await this.pollAllTenants();
    }
  }
}

module.exports = LinkedInConnectionPollingJob;
