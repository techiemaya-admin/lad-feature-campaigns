/**
 * Campaigns Feature Manifest
 * 
 * Multi-channel outreach campaigns with workflow automation.
 * Supports LinkedIn, Email, WhatsApp, Instagram, Voice calls, and more.
 */
module.exports = {
  name: 'Campaigns',
  key: 'campaigns',
  version: '1.0.0',
  description: 'Multi-channel outreach campaigns with LinkedIn and Email automation',
  // Feature availability
  plans: ['professional', 'enterprise'],
  // Credit costs
  credits: {
    per_campaign: 0,  // No cost to create campaign
    per_lead: 0.01,   // Small cost per lead processed
    per_action: 0.05  // Cost per action (message, connection request, etc.)
  },
  // API routes provided by this feature
  routes: [
    '',           // GET /api/campaigns - List campaigns
    'stats',      // GET /api/campaigns/stats - Get statistics
    'linkedin',   // LinkedIn integration routes (must be before :id routes)
    ':id',        // GET /api/campaigns/:id - Get campaign details
    ':id/start',  // POST /api/campaigns/:id/start - Start campaign
    ':id/pause',  // POST /api/campaigns/:id/pause - Pause campaign
    ':id/stop',   // POST /api/campaigns/:id/stop - Stop campaign
    ':id/leads',  // GET/POST /api/campaigns/:id/leads - Manage leads
    ':id/activities',  // GET /api/campaigns/:id/activities - Get activities
    ':id/steps'   // GET/POST /api/campaigns/:id/steps - Manage workflow steps
  ],
  // Dependencies
  dependencies: [
    'apollo-leads'  // For lead generation
  ],
  // Feature capabilities
  capabilities: [
    'view_campaigns',
    'create_campaigns',
    'edit_campaigns',
    'delete_campaigns',
    'manage_campaign_leads'
  ],
  
  // Feature lifecycle hooks
  onFeatureLoad: async (context) => {
    const logger = require('../../core/utils/logger');
    logger.info('[Campaigns Feature] Initializing LinkedIn polling scheduler');
    
    try {
      const { pollingScheduler } = require('./services/pollingScheduler');
      pollingScheduler.start();
      logger.info('[Campaigns Feature] LinkedIn polling scheduler started successfully');
    } catch (error) {
      logger.error('[Campaigns Feature] Failed to start polling scheduler', {
        error: error.message,
        stack: error.stack
      });
      // Don't fail feature load if polling fails to start
    }
  },
  
  onFeatureUnload: async (context) => {
    const logger = require('../../core/utils/logger');
    logger.info('[Campaigns Feature] Stopping LinkedIn polling scheduler');
    
    try {
      const { pollingScheduler } = require('./services/pollingScheduler');
      pollingScheduler.stop();
      logger.info('[Campaigns Feature] LinkedIn polling scheduler stopped successfully');
    } catch (error) {
      logger.error('[Campaigns Feature] Failed to stop polling scheduler', {
        error: error.message
      });
    }
  }
};
