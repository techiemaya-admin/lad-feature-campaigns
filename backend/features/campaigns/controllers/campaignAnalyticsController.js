/**
 * Campaign Analytics Controller
 * Handles fetching real-time campaign activity data
 */

const { query } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');

/**
 * Get campaign analytics/activity feed
 * GET /api/campaigns/:id/analytics
 */
async function getCampaignAnalytics(req, res) {
  const { id: campaignId } = req.params;
  const { limit = 50, offset = 0, platform, actionType, status } = req.query;

  try {
    // First, fetch the campaign details
    const campaignQuery = `
      SELECT id, name, status, tenant_id, created_by, config, created_at, updated_at, is_deleted
      FROM campaigns
      WHERE id = $1
    `;
    const campaignResult = await query(campaignQuery, [campaignId]);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const campaign = campaignResult.rows[0];

    // Count leads for this campaign
    const leadsCountQuery = `
      SELECT COUNT(*) as count FROM campaign_leads
      WHERE campaign_id = $1
    `;
    const leadsCountResult = await query(leadsCountQuery, [campaignId]);
    const leadsCount = parseInt(leadsCountResult.rows[0].count) || 0;

    // Count activities by action type
    const statsQuery = `
      SELECT 
        action_type,
        COUNT(*) as count
      FROM campaign_analytics
      WHERE campaign_id = $1 AND status = 'success'
      GROUP BY action_type
    `;
    const statsResult = await query(statsQuery, [campaignId]);
    
    // Build stats map
    const statsMap = {};
    statsResult.rows.forEach(row => {
      statsMap[row.action_type] = parseInt(row.count);
    });

    // Calculate totals from action types
    const sentCount = (statsMap['CONNECTION_SENT'] || 0) + (statsMap['MESSAGE_SENT'] || 0) + (statsMap['EMAIL_SENT'] || 0);
    const deliveredCount = (statsMap['MESSAGE_DELIVERED'] || 0) + (statsMap['WHATSAPP_DELIVERED'] || 0);
    const openedCount = (statsMap['MESSAGE_OPENED'] || 0) + (statsMap['EMAIL_OPENED'] || 0);
    const clickedCount = statsMap['MESSAGE_CLICKED'] || 0;
    const connectedCount = (statsMap['CONNECTION_ACCEPTED'] || 0) + (statsMap['VOICE_CALL_ANSWERED'] || 0);
    const repliedCount = statsMap['REPLY_RECEIVED'] || 0;

    // Build WHERE clause dynamically
    const conditions = ['campaign_id = $1'];
    const params = [campaignId];
    let paramIndex = 2;

    if (platform) {
      conditions.push(`platform = $${paramIndex}`);
      params.push(platform);
      paramIndex++;
    }
    if (actionType) {
      conditions.push(`action_type = $${paramIndex}`);
      params.push(actionType);
      paramIndex++;
    }
    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');
    
    // Fetch activities
    const activitiesQuery = `
      SELECT * FROM campaign_analytics
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const activitiesResult = await query(activitiesQuery, params);

    // Get total count (reuse same WHERE params)
    const countQuery = `
      SELECT COUNT(*) as count FROM campaign_analytics
      WHERE ${whereClause}
    `;
    const countResult = await query(countQuery, params.slice(0, paramIndex - 1));

    // Calculate metrics from the counts we gathered
    const deliveryRate = sentCount > 0 ? (deliveredCount / sentCount) * 100 : 0;
    const openRate = deliveredCount > 0 ? (openedCount / deliveredCount) * 100 : 0;
    const clickRate = openedCount > 0 ? (clickedCount / openedCount) * 100 : 0;
    const connectionRate = sentCount > 0 ? (connectedCount / sentCount) * 100 : 0;
    const replyRate = connectedCount > 0 ? (repliedCount / connectedCount) * 100 : 0;

    // Build analytics response with required structure
    const analyticsData = {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        created_at: campaign.created_at
      },
      overview: {
        total_leads: leadsCount,
        active_leads: campaign.status === 'running' ? leadsCount : 0,
        completed_leads: 0,
        stopped_leads: 0,
        sent: sentCount,
        delivered: deliveredCount,
        opened: openedCount,
        clicked: clickedCount,
        connected: connectedCount,
        replied: repliedCount
      },
      metrics: {
        delivery_rate: deliveryRate,
        open_rate: openRate,
        click_rate: clickRate,
        connection_rate: connectionRate,
        reply_rate: replyRate
      },
      timeline: [],
      activities: activitiesResult.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    res.json({
      success: true,
      data: analyticsData
    });

  } catch (error) {
    logger.error('[CampaignAnalytics] Failed to fetch analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign analytics'
    });
  }
}

/**
 * Get campaign analytics summary
 * GET /api/campaigns/:id/analytics/summary
 */
async function getCampaignAnalyticsSummary(req, res) {
  const { id: campaignId } = req.params;

  try {
    // Get activity counts by platform
    const platformStats = await db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .select('platform')
      .count('* as count')
      .groupBy('platform');

    // Get activity counts by action type
    const actionStats = await db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .select('action_type')
      .count('* as count')
      .groupBy('action_type');

    // Get success/failure rates
    const statusStats = await db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .select('status')
      .count('* as count')
      .groupBy('status');

    // Get recent activity (last 24 hours)
    const recentCount = await db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '24 hours'"))
      .count('* as count')
      .first();

    res.json({
      success: true,
      data: {
        platformStats,
        actionStats,
        statusStats,
        recentActivity24h: parseInt(recentCount?.count || 0)
      }
    });

  } catch (error) {
    logger.error('[CampaignAnalytics] Failed to fetch summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics summary'
    });
  }
}

module.exports = {
  getCampaignAnalytics,
  getCampaignAnalyticsSummary
};
