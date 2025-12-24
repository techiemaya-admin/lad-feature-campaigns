/**
 * Campaign Feature Index
 * 
 * Main entry point for the campaign feature module
 * Exports router and metadata
 */

const campaignsRouter = require('./routes');

module.exports = {
  // Router
  router: campaignsRouter,
  
  // Feature metadata
  meta: {
    id: 'campaigns',
    name: 'Campaigns',
    version: '1.0.0',
    description: 'Multi-channel outreach campaigns with workflow automation'
  }
};
