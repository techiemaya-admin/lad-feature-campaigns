/**
 * Campaign Stats Controller
 * SSE endpoint for real-time stats updates
 */

const { campaignEventsService } = require('../services/campaignEventsService');
const { campaignStatsTracker } = require('../services/campaignStatsTracker');
const { logger } = require('../../../core/utils/logger');

/**
 * SSE endpoint for real-time campaign stats updates
 * GET /api/campaigns/:id/events
 */
async function streamCampaignStats(req, res) {
  const { id: campaignId } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial stats immediately
  try {
    const initialStats = await campaignStatsTracker.getStats(campaignId);
    res.write(`data: ${JSON.stringify({ 
      type: 'INITIAL_STATS', 
      campaignId, 
      stats: initialStats,
      timestamp: new Date().toISOString()
    })}\n\n`);
  } catch (error) {
    logger.error('[SSE] Failed to send initial stats:', error);
    res.write(`data: ${JSON.stringify({ type: 'ERROR', message: 'Failed to load stats' })}\n\n`);
  }

  // Subscribe to campaign stats updates
  const listener = (event) => {
    if (event.campaignId === campaignId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  campaignEventsService.subscribe(listener);

  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
    logger.debug(`[SSE] Client disconnected from campaign ${campaignId}`);
  });

  // Handle errors
  req.on('error', (error) => {
    logger.error('[SSE] Connection error:', error);
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
  });
}

/**
 * Get current campaign stats (REST fallback)
 * GET /api/campaigns/:id/stats
 */
async function getCampaignStats(req, res) {
  const { id: campaignId } = req.params;

  try {
    const stats = await campaignStatsTracker.getStats(campaignId);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('[Stats] Failed to get campaign stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Manually trigger stats refresh (for testing)
 * POST /api/campaigns/:id/stats/refresh
 */
async function refreshCampaignStats(req, res) {
  const { id: campaignId } = req.params;

  try {
    const stats = await campaignStatsTracker.getStats(campaignId);
    await campaignEventsService.publishStatsUpdate(campaignId, stats);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('[Stats] Failed to refresh stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  streamCampaignStats,
  getCampaignStats,
  refreshCampaignStats
};
