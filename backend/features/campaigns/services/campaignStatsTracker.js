/**
 * Campaign Stats Tracker
 * Atomically updates campaign stats and emits real-time events
 * WITHOUT modifying database schema
 */

const { db } = require('../../../shared/database/connection');
const { campaignEventsService } = require('./campaignEventsService');
const logger = require('../../../core/utils/logger');

class CampaignStatsTracker {
  /**
   * Track campaign action and update stats atomically
   * @param {string} campaignId 
   * @param {string} actionType - CONNECTION_SENT, CONNECTION_ACCEPTED, MESSAGE_SENT, REPLY_RECEIVED, etc.
   * @param {object} metadata - { leadId, channel: 'linkedin'|'email'|'whatsapp'|'voice'|'instagram', leadName, leadPhone, leadEmail, messageContent, status }
   */
  async trackAction(campaignId, actionType, metadata = {}) {
    const { 
      leadId, 
      channel = 'linkedin',
      leadName,
      leadPhone,
      leadEmail,
      messageContent,
      status = 'success',
      errorMessage,
      responseData
    } = metadata;

    try {
      // Use transaction for atomic updates
      await db.transaction(async (trx) => {
        // 1. Update campaign stats based on action type
        const updateField = this._getStatsField(actionType);
        
        if (updateField) {
          await trx('campaigns')
            .where({ id: campaignId })
            .increment(updateField, 1);
          
          logger.debug(`[StatsTracker] ${actionType} -> ${updateField}+1 for campaign ${campaignId}`);
        }

        // 2. Insert into campaign_analytics for real-time tracking
        try {
          await trx('campaign_analytics').insert({
            campaign_id: campaignId,
            lead_id: leadId,
            action_type: actionType,
            platform: channel,
            status: status,
            lead_name: leadName,
            lead_phone: leadPhone,
            lead_email: leadEmail,
            message_content: messageContent,
            error_message: errorMessage,
            response_data: responseData ? JSON.stringify(responseData) : null,
            created_at: new Date()
          });
          
          logger.debug(`[StatsTracker] Activity logged to campaign_analytics`);
        } catch (error) {
          logger.warn('[StatsTracker] Failed to insert into campaign_analytics:', error.message);
        }
      });

      // 3. Fetch updated stats and emit event
      await this._emitStatsUpdate(campaignId);

    } catch (error) {
      logger.error(`[StatsTracker] Failed to track ${actionType}:`, error);
      throw error;
    }
  }

  /**
   * Batch track multiple actions (for background workers)
   * @param {Array} actions - [{ campaignId, actionType, metadata }]
   */
  async trackBatch(actions) {
    const groupedByCampaign = actions.reduce((acc, action) => {
      if (!acc[action.campaignId]) {
        acc[action.campaignId] = [];
      }
      acc[action.campaignId].push(action);
      return acc;
    }, {});

    for (const [campaignId, campaignActions] of Object.entries(groupedByCampaign)) {
      try {
        await db.transaction(async (trx) => {
          // Aggregate increments to avoid multiple updates
          const increments = {};
          const activities = [];

          for (const action of campaignActions) {
            const field = this._getStatsField(action.actionType);
            if (field) {
              increments[field] = (increments[field] || 0) + 1;
            }

            activities.push({
              campaign_id: campaignId,
              lead_id: action.metadata?.leadId,
              action_type: action.actionType,
              channel: action.metadata?.channel || 'linkedin',
              created_at: new Date()
            });
          }

          // Batch update campaign stats
          for (const [field, count] of Object.entries(increments)) {
            await trx('campaigns')
              .where({ id: campaignId })
              .increment(field, count);
          }

          // Batch insert activities
          if (activities.length > 0) {
            try {
              await trx('campaign_activities').insert(activities);
            } catch (error) {
              logger.debug('[StatsTracker] Activities table not available');
            }
          }
        });

        await this._emitStatsUpdate(campaignId);

      } catch (error) {
        logger.error(`[StatsTracker] Batch tracking failed for campaign ${campaignId}:`, error);
      }
    }
  }

  /**
   * Handle external async events (like replies from webhooks)
   * Ensures idempotency to prevent duplicate counting
   * @param {string} campaignId 
   * @param {string} leadId 
   * @param {string} channel 
   * @param {string} externalId - Unique identifier from external system
   */
  async trackReply(campaignId, leadId, channel, externalId) {
    try {
      await db.transaction(async (trx) => {
        // Check if this reply was already processed
        const existing = await trx('campaign_activities')
          .where({
            campaign_id: campaignId,
            lead_id: leadId,
            action_type: 'REPLY_RECEIVED',
            external_id: externalId
          })
          .first();

        if (existing) {
          logger.debug(`[StatsTracker] Duplicate reply ignored: ${externalId}`);
          return;
        }

        // Increment replied_count
        await trx('campaigns')
          .where({ id: campaignId })
          .increment('replied_count', 1);

        // Record activity with external_id for idempotency
        await trx('campaign_activities').insert({
          campaign_id: campaignId,
          lead_id: leadId,
          action_type: 'REPLY_RECEIVED',
          channel: channel,
          external_id: externalId,
          created_at: new Date()
        });

        logger.debug(`[StatsTracker] Reply tracked: ${externalId}`);
      });

      await this._emitStatsUpdate(campaignId);

    } catch (error) {
      logger.error('[StatsTracker] Failed to track reply:', error);
      throw error;
    }
  }

  /**
   * Get current stats for a campaign with per-platform breakdown
   * @param {string} campaignId 
   * @returns {object} Campaign stats with platform_metrics
   */
  async getStats(campaignId) {
    try {
      // Return empty stats for now until we fully implement the tracker
      // TODO: Implement proper stats fetching from campaigns table
      return {
        leads_count: 0,
        sent_count: 0,
        connected_count: 0,
        replied_count: 0,
        delivered_count: 0,
        opened_count: 0,
        clicked_count: 0,
        platform_metrics: null
      };

    } catch (error) {
      logger.error('[StatsTracker] Failed to get stats:', error);
      throw error;
    }
  }

  /**
   * Map action types to campaign stat fields
   * @private
   */
  _getStatsField(actionType) {
    const mapping = {
      'CONNECTION_SENT': 'sent_count',
      'CONNECTION_ACCEPTED': 'connected_count',
      'MESSAGE_SENT': 'sent_count',
      'MESSAGE_DELIVERED': 'delivered_count',
      'MESSAGE_OPENED': 'opened_count',
      'MESSAGE_CLICKED': 'clicked_count',
      'REPLY_RECEIVED': 'replied_count',
      'PROFILE_VISITED': null, // Don't count as sent
      'EMAIL_SENT': 'sent_count',
      'EMAIL_OPENED': 'opened_count',
      'WHATSAPP_SENT': 'sent_count',
      'WHATSAPP_DELIVERED': 'delivered_count',
      'VOICE_CALL_MADE': 'sent_count',
      'VOICE_CALL_ANSWERED': 'connected_count'
    };

    return mapping[actionType] || null;
  }

  /**
   * Build platform metrics from activities
   * @private
   */
  _buildPlatformMetrics(activities) {
    const metrics = {
      linkedin: { sent: 0, connected: 0, replied: 0 },
      email: { sent: 0, connected: 0, replied: 0 },
      whatsapp: { sent: 0, connected: 0, replied: 0 },
      voice: { sent: 0, connected: 0, replied: 0 },
      instagram: { sent: 0, connected: 0, replied: 0 }
    };

    activities.forEach(({ channel, action_type, count }) => {
      const platform = metrics[channel];
      if (!platform) return;

      const countNum = parseInt(count, 10);

      if (action_type.includes('SENT') || action_type.includes('CALL_MADE')) {
        platform.sent += countNum;
      }
      if (action_type.includes('ACCEPTED') || action_type.includes('ANSWERED')) {
        platform.connected += countNum;
      }
      if (action_type.includes('REPLY')) {
        platform.replied += countNum;
      }
    });

    return metrics;
  }

  /**
   * Emit stats update event
   * @private
   */
  async _emitStatsUpdate(campaignId) {
    try {
      const stats = await this.getStats(campaignId);
      await campaignEventsService.publishStatsUpdate(campaignId, stats);
    } catch (error) {
      logger.error('[StatsTracker] Failed to emit stats update:', error);
    }
  }
}

// Singleton instance
const campaignStatsTracker = new CampaignStatsTracker();

module.exports = { campaignStatsTracker };
