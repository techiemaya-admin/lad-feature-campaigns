/**
 * Campaign Stats Tracker
 * Atomically updates campaign stats and emits real-time events
 * WITHOUT modifying database schema
 */
const { pool } = require('../../../shared/database/connection');
const { campaignEventsService } = require('./campaignEventsService');
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
        // 1. Try to update campaign stats based on action type (optional - may not have columns)
        const updateField = this._getStatsField(actionType);
        if (updateField) {
          try {
            await trx('campaigns')
              .where({ id: campaignId })
              .increment(updateField, 1);
          } catch (updateErr) {
            // Column may not exist - that's OK, continue with analytics insert
          }
        }
        // 2. Insert into campaign_analytics for real-time tracking (THIS IS THE MAIN PURPOSE)
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
        } catch (error) {
          throw error; // Re-throw so we know if analytics insert failed
        }
      });
      // 3. Fetch updated stats and emit event for SSE
      await this._emitStatsUpdate(campaignId);
    } catch (error) {
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
            }
          }
        });
        await this._emitStatsUpdate(campaignId);
      } catch (error) {
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
      });
      await this._emitStatsUpdate(campaignId);
    } catch (error) {
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
      // Get total leads count from campaign_leads table
      const leadsResult = await pool.query(
        'SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = $1',
        [campaignId]
      );
      const totalLeads = parseInt(leadsResult.rows[0]?.count || 0);
      
      // Get stats from campaign_analytics with platform breakdown
      // ✅ Only count successful actions (status = 'success')
      const analyticsResult = await pool.query(
        `SELECT action_type, platform, COUNT(*) as count 
         FROM campaign_analytics 
         WHERE campaign_id = $1 AND status = $2 
         GROUP BY action_type, platform`,
        [campaignId, 'success']
      );
      const analyticsStats = analyticsResult.rows;
      // Build platform metrics
      const platformMetrics = {
        linkedin: { sent: 0, connected: 0, replied: 0, profile_views: 0 },
        email: { sent: 0, connected: 0, replied: 0, opened: 0, clicked: 0 },
        whatsapp: { sent: 0, connected: 0, replied: 0, delivered: 0 },
        voice: { sent: 0, connected: 0, replied: 0 },
        instagram: { sent: 0, connected: 0, replied: 0 }
      };
      // Build aggregate stats
      const stats = {
        leads_count: totalLeads,
        sent_count: 0,
        connected_count: 0,
        replied_count: 0,
        delivered_count: 0,
        opened_count: 0,
        clicked_count: 0,
        platform_metrics: platformMetrics
      };
      // Map analytics to stats and platform metrics
      analyticsStats.forEach(row => {
        const actionType = row.action_type;
        const platform = row.platform || 'linkedin';
        const count = parseInt(row.count);
        const platformData = platformMetrics[platform];
        // Update aggregate stats
        switch (actionType) {
          case 'CONNECTION_SENT':
          case 'MESSAGE_SENT':
          case 'EMAIL_SENT':
          case 'WHATSAPP_SENT':
          case 'VOICE_CALL_MADE':
            stats.sent_count += count;
            if (platformData) platformData.sent += count;
            break;
          case 'CONNECTION_ACCEPTED':
          case 'VOICE_CALL_ANSWERED':
            stats.connected_count += count;
            if (platformData) platformData.connected += count;
            break;
          case 'REPLY_RECEIVED':
            stats.replied_count += count;
            if (platformData) platformData.replied += count;
            break;
          case 'MESSAGE_DELIVERED':
          case 'WHATSAPP_DELIVERED':
            stats.delivered_count += count;
            if (platformData && platformData.delivered !== undefined) {
              platformData.delivered += count;
            }
            break;
          case 'MESSAGE_OPENED':
          case 'EMAIL_OPENED':
            stats.opened_count += count;
            if (platformData && platformData.opened !== undefined) {
              platformData.opened += count;
            }
            break;
          case 'MESSAGE_CLICKED':
            stats.clicked_count += count;
            if (platformData && platformData.clicked !== undefined) {
              platformData.clicked += count;
            }
            break;
          case 'PROFILE_VIEW':
            if (platformData && platformData.profile_views !== undefined) {
              platformData.profile_views += count;
            }
            break;
        }
      });
      return stats;
    } catch (error) {
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
    }
  }
}
// Singleton instance
const campaignStatsTracker = new CampaignStatsTracker();
module.exports = { campaignStatsTracker };
