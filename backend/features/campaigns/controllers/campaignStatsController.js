/**
 * Campaign Stats Controller
 * SSE endpoint for real-time stats updates
 */
const { campaignEventsService } = require('../services/campaignEventsService');
const { campaignStatsTracker } = require('../services/campaignStatsTracker');
const logger = require('../../../core/utils/logger');
/**
 * SSE endpoint for real-time campaign stats updates
 * GET /api/campaigns/:id/events
 */
async function streamCampaignStats(req, res) {
  const { id: campaignId } = req.params;
  
  logger.info('[SSE] Connection request', {
    campaignId,
    userId: req.user?.userId,
    origin: req.headers.origin
  });
  
  // SSE headers are already set by authenticateSSE middleware
  logger.info('[SSE] Fetching initial stats', { campaignId });
  
  // Send initial stats immediately
  try {
    logger.info('[SSE] Calling campaignStatsTracker.getStats', { campaignId });
    const initialStats = await campaignStatsTracker.getStats(campaignId);
    logger.info('[SSE] Stats fetched successfully', { campaignId, stats: initialStats });
    
    const initialMessage = JSON.stringify({ 
      type: 'INITIAL_STATS', 
      campaignId, 
      stats: initialStats,
      timestamp: new Date().toISOString()
    });
    
    logger.info('[SSE] Sending initial stats', { campaignId, messageLength: initialMessage.length });
    res.write(`data: ${initialMessage}\n\n`);
    logger.info('[SSE] Initial stats sent successfully', { campaignId });
  } catch (error) {
    logger.error('[SSE] Failed to load stats', {
      campaignId,
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    // Send empty stats instead of error to keep connection open
    res.write(`data: ${JSON.stringify({ 
      type: 'INITIAL_STATS', 
      campaignId, 
      stats: {
        leads_count: 0,
        sent_count: 0,
        connected_count: 0,
        replied_count: 0,
        delivered_count: 0,
        opened_count: 0,
        clicked_count: 0,
        platform_metrics: {}
      },
      error: 'Stats unavailable',
      timestamp: new Date().toISOString()
    })}\n\n`);
  }
  // Subscribe to campaign stats updates
  const listener = (event) => {
    if (event.campaignId === campaignId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  campaignEventsService.subscribe(listener);
  
  logger.info('[SSE] Subscriber added, connection established', { campaignId });
  
  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);
  // Cleanup on client disconnect
  req.on('close', () => {
    logger.info('[SSE] Client disconnected', { campaignId });
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
  });
  // Handle errors
  req.on('error', (error) => {
    logger.error('[SSE] Connection error', { campaignId, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
}
module.exports = {
  streamCampaignStats,
  getCampaignStats,
  refreshCampaignStats
};
