/**
 * Campaigns List SSE Controller
 * Real-time updates for all campaigns
 */

const { campaignEventsService } = require('../services/campaignEventsService');
const { db } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');

/**
 * SSE endpoint for real-time campaigns list updates
 * GET /api/campaigns/stream
 */
async function streamAllCampaigns(req, res) {
  // Set SSE headers with CORS support
  const origin = req.headers.origin || '*';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/Cloud Run buffering
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  logger.info('[SSE] Client connected to campaigns stream');

  // Send initial data immediately
  try {
    const campaigns = await db('campaigns')
      .select('*')
      .orderBy('created_at', 'desc');

    res.write(`data: ${JSON.stringify({ 
      type: 'INITIAL_DATA', 
      campaigns,
      timestamp: new Date().toISOString()
    })}\n\n`);
  } catch (error) {
    logger.error('[SSE] Failed to send initial campaigns:', error);
    res.write(`data: ${JSON.stringify({ type: 'ERROR', message: 'Failed to load campaigns' })}\n\n`);
  }

  // Subscribe to campaign updates
  const listener = (event) => {
    // Broadcast all campaign-related events to connected clients
    res.write(`data: ${JSON.stringify({
      ...event,
      timestamp: new Date().toISOString()
    })}\n\n`);
  };

  campaignEventsService.subscribe(listener);

  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    logger.info('[SSE] Client disconnected from campaigns stream');
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
  });

  req.on('error', (error) => {
    logger.error('[SSE] Stream error:', error);
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
  });
}

module.exports = {
  streamAllCampaigns
};
