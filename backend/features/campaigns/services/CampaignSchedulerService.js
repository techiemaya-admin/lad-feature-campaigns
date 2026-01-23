/**
 * Campaign Scheduler Service
 * Handles periodic checking of campaigns to ensure they run on schedule
 */
const { pool } = require('../../../shared/database/connection');
const CampaignProcessor = require('./CampaignProcessor');
const { campaignStatsTracker } = require('./campaignStatsTracker');
const { campaignEventsService } = require('./campaignEventsService');
const logger = require('../../../core/utils/logger');
class CampaignSchedulerService {
    constructor() {
        this.isRunning = false;
        this.checkIntervalMs = 60 * 1000; // Check every minute
        this.intervalId = null;
    }
    start() {
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;
        // Run immediately
        this.checkCampaigns();
        // Then run periodically
        this.intervalId = setInterval(() => this.checkCampaigns(), this.checkIntervalMs);
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
    }
    async checkCampaigns() {
        try {
            // Use configured schema or default to lad_dev
            const schema = process.env.DB_SCHEMA || 'lad_dev';
            // Query for campaigns that are:
            // 1. 'active' (continuous processing)
            // 2. 'sleeping_until_next_day' AND next_run_at <= NOW()
            // 3. 'waiting_for_leads' AND next_run_at <= NOW()
            // Note: We check 'running' status (user-controlled) AND execution_state (system-controlled)
            const query = `
        SELECT id, tenant_id, execution_state, next_run_at
        FROM ${schema}.campaigns 
        WHERE status = 'running' 
          AND is_deleted = FALSE 
          AND (
            execution_state = 'active'
            OR (execution_state = 'sleeping_until_next_day' AND next_run_at <= NOW())
            OR (execution_state = 'waiting_for_leads' AND next_run_at <= NOW())
          )
      `;
            const result = await pool.query(query);
            if (result.rows.length > 0) {
                    campaigns: result.rows.map(c => c.id)
                });
                for (const campaign of result.rows) {
                    // Process each campaign
                    // Serial execution to prevent overwhelming the database
                    try {
                        await CampaignProcessor.processCampaign(
                            campaign.id,
                            campaign.tenant_id
                        );
                        // Emit SSE event so frontend updates in real-time
                        try {
                            const stats = await campaignStatsTracker.getStats(campaign.id);
                            await campaignEventsService.publishCampaignListUpdate(campaign.id, stats);
                                campaignId: campaign.id, 
                                leads: stats.leads_count, 
                                sent: stats.sent_count 
                            });
                        } catch (sseError) {
                                campaignId: campaign.id, 
                                error: sseError.message 
                            });
                        }
                    } catch (err) {
                    }
                }
            } else {
            }
        } catch (error) {
            // Check for common errors (like table not existing if schema is wrong)
            if (error.code === '42P01') { // undefined_table
            } else {
            }
        }
    }
}
module.exports = new CampaignSchedulerService();
