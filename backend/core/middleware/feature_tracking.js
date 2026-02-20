const logger = require('../utils/logger');

const trackClientFeatures = async (req, res, next) => {
  // Track feature usage for analytics and billing
  if (req.user && req.path.startsWith('/api/')) {
    const pathParts = req.path.split('/');
    const possibleFeature = pathParts[2]; // /api/apollo-leads -> apollo-leads
    
    if (possibleFeature && possibleFeature !== 'auth' && possibleFeature !== 'billing' && possibleFeature !== 'users') {
      // This is a feature request
      req.featureUsage = {
        clientId: req.user.tenantId || req.user.organizationId || req.user.clientId,
        feature: possibleFeature,
        endpoint: req.path,
        method: req.method,
        timestamp: new Date()
      };
      
      // Log feature usage (could be sent to analytics service)
      logger.debug('Feature usage', req.featureUsage);
    }
  }
  
  next();
};

module.exports = { trackClientFeatures };