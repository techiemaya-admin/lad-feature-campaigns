/**
 * Campaign Stats Tracker
 * Atomically updates campaign stats and emits real-time events
 * WITHOUT modifying database schema
 */
const { pool } = require('../../../shared/database/connection');
const { campaignEventsService } = require('./campaignEventsService');
const { getSchema } = require('../../../core/utils/schemaHelper');
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
      responseData,
      tenantId,
      accountName,
      providerAccountId,
      leadLinkedin
    } = metadata;
    
    const schema = getSchema(null);
    
    try {
      // Insert into campaign_analytics for real-time tracking using pool
      await pool.query(
        `INSERT INTO ${schema}.campaign_analytics 
         (campaign_id, lead_id, action_type, platform, status, lead_name, lead_phone, lead_email, message_content, error_message, response_data, tenant_id, account_name, provider_account_id, lead_linkedin, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
        [
          campaignId,
          leadId,
          actionType,
          channel,
          status,
          leadName,
          leadPhone,
          leadEmail,
          messageContent,
          errorMessage,
          responseData ? JSON.stringify(responseData) : null,
          tenantId,
          accountName,
          providerAccountId,
          leadLinkedin
        ]
      );
      
      logger.info('[CampaignStatsTracker] Action tracked', {
        campaignId: campaignId?.substring(0, 8),
        actionType,
        status,
        channel
      });
      
      // Emit stats update event
      await this._emitStatsUpdate(campaignId);
    } catch (error) {
      logger.error('[CampaignStatsTracker] Failed to track action', {
        campaignId,
        actionType,
        error: error.message
      });
      // Don't throw - tracking failures shouldn't break the main flow
    }
  }
  /**
   * Batch track multiple actions (for background workers)
   * @param {Array} actions - [{ campaignId, actionType, metadata }]
   */
  async trackBatch(actions) {
    const schema = getSchema(null);
    const groupedByCampaign = actions.reduce((acc, action) => {
      if (!acc[action.campaignId]) {
        acc[action.campaignId] = [];
      }
      acc[action.campaignId].push(action);
      return acc;
    }, {});
    
    for (const [campaignId, campaignActions] of Object.entries(groupedByCampaign)) {
      try {
        // Insert each action individually
        for (const action of campaignActions) {
          await this.trackAction(campaignId, action.actionType, action.metadata);
        }
        await this._emitStatsUpdate(campaignId);
      } catch (error) {
        logger.error('[CampaignStatsTracker] Batch track error', { campaignId, error: error.message });
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
    const schema = getSchema(null);
    
    try {
      // Check if this reply was already processed
      const existing = await pool.query(
        `SELECT id FROM ${schema}.campaign_analytics 
         WHERE campaign_id = $1 AND lead_id = $2 AND action_type = $3`,
        [campaignId, leadId, 'REPLY_RECEIVED']
      );
      
      if (existing.rows.length > 0) {
        logger.info('[CampaignStatsTracker] Reply already tracked, skipping', { campaignId, leadId });
        return;
      }
      
      // Track the reply
      await this.trackAction(campaignId, 'REPLY_RECEIVED', {
        leadId,
        channel,
        status: 'success'
      });
      
      await this._emitStatsUpdate(campaignId);
    } catch (error) {
      logger.error('[CampaignStatsTracker] Failed to track reply', { campaignId, error: error.message });
    }
  }
  
  /**
   * Get current stats for a campaign with per-platform breakdown
   * @param {string} campaignId 
   * @returns {object} Campaign stats with platform_metrics
   */
  async getStats(campaignId) {
    const schema = getSchema(null);
    
    try {
      // Get total leads count from campaign_leads table
      const leadsResult = await pool.query(
        `SELECT COUNT(*) as count FROM ${schema}.campaign_leads WHERE campaign_id = $1`,
        [campaignId]
      );
      const totalLeads = parseInt(leadsResult.rows[0]?.count || 0);
      
      // Get stats from campaign_analytics with platform breakdown
      // ✅ Only count successful actions (status = 'success')
      let analyticsStats = [];
      
      // Try campaign_analytics first
      try {
        const analyticsResult = await pool.query(
          `SELECT action_type, platform, COUNT(*) as count 
           FROM ${schema}.campaign_analytics 
           WHERE campaign_id = $1 AND status = $2 
           GROUP BY action_type, platform`,
          [campaignId, 'success']
        );
        analyticsStats = analyticsResult.rows;
      } catch (err) {
        logger.warn('[CampaignStatsTracker] campaign_analytics query failed', { error: err.message });
      }
      
      // If no stats from campaign_analytics, try campaign_lead_activities
      if (analyticsStats.length === 0) {
        try {
          const activitiesResult = await pool.query(
            `SELECT action_type, channel as platform, COUNT(*) as count 
             FROM ${schema}.campaign_lead_activities 
             WHERE campaign_id = $1 AND status = $2 AND is_deleted = false
             GROUP BY action_type, channel`,
            [campaignId, 'delivered']
          );
          
          // Map activity types to analytics action types
          analyticsStats = activitiesResult.rows.map(row => {
            let mappedActionType = row.action_type;
            // Map campaign_lead_activities action_type to campaign_analytics action_type
            const actionTypeMap = {
              'linkedin_connect': 'CONNECTION_SENT',
              'linkedin_visit': 'PROFILE_VISITED',
              'linkedin_message': 'MESSAGE_SENT',
              'connection_request': 'CONNECTION_SENT',
              'profile_visit': 'PROFILE_VISITED',
              'send_message': 'MESSAGE_SENT'
            };
            mappedActionType = actionTypeMap[row.action_type] || row.action_type.toUpperCase();
            
            return {
              action_type: mappedActionType,
              platform: row.platform || 'linkedin',
              count: row.count
            };
          });
          
          logger.info('[CampaignStatsTracker] Using campaign_lead_activities fallback', {
            campaignId: campaignId?.substring(0, 8),
            statsCount: analyticsStats.length
          });
        } catch (activitiesErr) {
          logger.warn('[CampaignStatsTracker] campaign_lead_activities query failed', { error: activitiesErr.message });
        }
      }
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
