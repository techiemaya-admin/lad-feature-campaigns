/**
 * Campaign Analytics Controller
 * Handles fetching real-time campaign activity data
 */

const { db } = require('../../../../shared/database/connection');
const { logger } = require('../../../core/utils/logger');

/**
 * Get campaign analytics/activity feed
 * GET /api/campaigns/:id/analytics
 */
async function getCampaignAnalytics(req, res) {
  const { id: campaignId } = req.params;
  const { limit = 50, offset = 0, platform, actionType, status } = req.query;

  try {
    let query = db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    // Apply filters
    if (platform) {
      query = query.where({ platform });
    }
    if (actionType) {
      query = query.where({ action_type: actionType });
    }
    if (status) {
      query = query.where({ status });
    }

    const activities = await query;

    // Get total count
    const [{ count }] = await db('campaign_analytics')
      .where({ campaign_id: campaignId })
      .count('* as count');

    res.json({
      success: true,
      data: {
        activities,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
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
