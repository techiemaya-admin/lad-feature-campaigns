/**
 * Campaigns List SSE Controller
 * Real-time updates for all campaigns
 */
const { campaignEventsService } = require('../services/campaignEventsService');
const { db } = require('../../../shared/database/connection');
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
  // Subscribe to global campaign events
  campaignEventsService.subscribe(listener);
  // Also subscribe specifically to the campaigns list updates channel
  const listChannel = 'campaigns:list:updates';
  if (!campaignEventsService.inMemoryListeners.has(listChannel)) {
    campaignEventsService.inMemoryListeners.set(listChannel, new Set());
  }
  campaignEventsService.inMemoryListeners.get(listChannel).add(listener);
  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);
  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
    // Also unsubscribe from list updates channel
    const listChannel = 'campaigns:list:updates';
    const channelListeners = campaignEventsService.inMemoryListeners.get(listChannel);
    if (channelListeners) {
      channelListeners.delete(listener);
    }
  });
  req.on('error', (error) => {
    clearInterval(heartbeat);
    campaignEventsService.unsubscribe(listener);
  });
}
module.exports = {
  streamAllCampaigns
};
