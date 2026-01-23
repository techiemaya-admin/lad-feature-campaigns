/**
 * Campaign Events Service
 * Handles real-time event emission for campaign stats updates
 * Uses Redis pub/sub for distributed event broadcasting
 */
const Redis = require('ioredis');
class CampaignEventsService {
  constructor() {
    // Redis pub/sub clients (separate instances required)
    this.publisher = process.env.REDIS_URL 
      ? new Redis(process.env.REDIS_URL)
      : null;
    this.subscriber = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL)
      : null;
    // In-memory fallback for development
    this.inMemoryListeners = new Map();
    if (this.subscriber) {
      this.subscriber.on('message', (channel, message) => {
        this._handleMessage(channel, message);
      });
    }
  }
  /**
   * Publish campaign stats update event
   * @param {string} campaignId 
   * @param {object} stats - Updated campaign stats
   */
  async publishStatsUpdate(campaignId, stats) {
    const event = {
      type: 'CAMPAIGN_STATS_UPDATED',
      campaignId,
      stats,
      timestamp: new Date().toISOString()
    };
    const channel = `campaign:${campaignId}:stats`;
    const payload = JSON.stringify(event);
    try {
      if (this.publisher) {
        await this.publisher.publish(channel, payload);
      } else {
        // In-memory fallback
        this._emitInMemory(channel, event);
      }
      // Also publish to global campaigns list channel
      await this.publishCampaignListUpdate(campaignId, stats);
    } catch (error) {
    }
  }
  /**
   * Publish campaign list update event (for campaigns table)
   */
  async publishCampaignListUpdate(campaignId, stats) {
    const event = {
      type: 'campaign-update',
      campaignId,
      stats,
      timestamp: new Date().toISOString()
    };
    const channel = 'campaigns:list:updates';
    const payload = JSON.stringify(event);
    try {
      if (this.publisher) {
        await this.publisher.publish(channel, payload);
      } else {
        this._emitInMemory(channel, event);
      }
    } catch (error) {
    }
  }
  /**
   * Subscribe to campaign updates
   * @param {function} callback - Callback receives event object
   * If no campaignId, subscribes to ALL campaign events
   */
  async subscribe(callbackOrCampaignId, callback) {
    // Support both: subscribe(callback) and subscribe(campaignId, callback)
    const isGlobalSubscription = typeof callbackOrCampaignId === 'function';
    const actualCallback = isGlobalSubscription ? callbackOrCampaignId : callback;
    const campaignId = isGlobalSubscription ? null : callbackOrCampaignId;
    if (campaignId) {
      // Subscribe to specific campaign
      const channel = `campaign:${campaignId}:stats`;
      if (this.subscriber) {
        await this.subscriber.subscribe(channel);
      }
      // Store listener
      if (!this.inMemoryListeners.has(channel)) {
        this.inMemoryListeners.set(channel, new Set());
      }
      this.inMemoryListeners.get(channel).add(actualCallback);
    } else {
      // Global subscription to ALL campaigns
      const globalChannel = 'campaign:*:stats';
      if (this.subscriber) {
        await this.subscriber.psubscribe(globalChannel);
      }
      // Store global listener
      if (!this.inMemoryListeners.has('__global__')) {
        this.inMemoryListeners.set('__global__', new Set());
      }
      this.inMemoryListeners.get('__global__').add(actualCallback);
    }
  }
  /**
   * Unsubscribe from campaign updates
   * @param {function} callback 
   */
  async unsubscribe(callbackOrCampaignId, callback) {
    const isGlobalSubscription = typeof callbackOrCampaignId === 'function';
    const actualCallback = isGlobalSubscription ? callbackOrCampaignId : callback;
    const campaignId = isGlobalSubscription ? null : callbackOrCampaignId;
    if (campaignId) {
      const channel = `campaign:${campaignId}:stats`;
      const listeners = this.inMemoryListeners.get(channel);
      if (listeners) {
        listeners.delete(actualCallback);
        // Unsubscribe from Redis if no more listeners
        if (listeners.size === 0 && this.subscriber) {
          await this.subscriber.unsubscribe(channel);
        }
      }
    } else {
      // Global unsubscribe
      const globalListeners = this.inMemoryListeners.get('__global__');
      if (globalListeners) {
        globalListeners.delete(actualCallback);
        if (globalListeners.size === 0 && this.subscriber) {
          await this.subscriber.punsubscribe('campaign:*:stats');
        }
      }
    }
  }
  /**
   * Handle incoming Redis messages
   * @private
   */
  _handleMessage(channel, message) {
    try {
      const event = JSON.parse(message);
      this._emitInMemory(channel, event);
    } catch (error) {
    }
  }
  /**
   * Emit event to in-memory listeners
   * @private
   */
  _emitInMemory(channel, event) {
    // Emit to specific channel listeners
    const listeners = this.inMemoryListeners.get(channel);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
        }
      });
    }
    // Also emit to global listeners
    const globalListeners = this.inMemoryListeners.get('__global__');
    if (globalListeners) {
      globalListeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
        }
      });
    }
  }
  /**
   * Cleanup connections
   */
  async disconnect() {
    if (this.publisher) await this.publisher.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.inMemoryListeners.clear();
  }
}
// Singleton instance
const campaignEventsService = new CampaignEventsService();
module.exports = { campaignEventsService };