/**
 * Feature Guard Middleware
 * 
 * PURPOSE:
 * Enforces feature access control at the API route level. This middleware
 * ensures that clients can only access features they have paid for or been
 * explicitly granted access to.
 * 
 * SECURITY ENFORCEMENT:
 * This is where feature boundary enforcement happens. Without this middleware,
 * features would be "organized but not enforced" - the key gap we identified.
 * 
 * MIDDLEWARE TYPES:
 * 1. requireFeature(key): Single feature required
 * 2. requireAnyFeature([keys]): OR logic - any one feature enabled
 * 3. requireAllFeatures([keys]): AND logic - all features required
 * 
 * INTEGRATION FLOW:
 * 1. Extract clientId from authenticated user context
 * 2. Call FeatureFlagService.isEnabled(clientId, featureKey)
 * 3. Allow or deny request based on feature access
 * 4. Attach feature context to request for downstream use
 * 
 * ERROR RESPONSES:
 * - 401: Missing client identification
 * - 403: Feature not enabled for client (upgrade required)
 * - 500: Feature flag service error (fail closed)
 * 
 * USAGE EXAMPLES:
 * 
 * Single feature:
 * router.use('/api/apollo-leads', requireFeature('apollo-leads'));
 * 
 * Any of multiple features:
 * router.use('/api/search', requireAnyFeature(['apollo-leads', 'linkedin-integration']));
 * 
 * All features required:
 * router.use('/api/advanced', requireAllFeatures(['apollo-leads', 'voice-agent']));
 * 
 * CONTEXT PROVIDED:
 * - req.feature: Feature information for single feature
 * - req.features: Array of features for multiple feature checks
 * 
 * BILLING INTEGRATION:
 * Feature context flows to credit_guard middleware for usage tracking.
 */

const { FeatureFlagService } = require('../../feature_flags/service');

const featureFlagService = new FeatureFlagService();

/**
 * Middleware to check if a feature is enabled for the current client
 */
const requireFeature = (featureKey) => {
  return async (req, res, next) => {
    try {
      // Support both organizationId (new schema), tenantId, and clientId (legacy) 
      const organizationId = req.user?.tenantId || req.user?.organizationId || req.user?.clientId || req.headers['x-organization-id'] || req.headers['x-client-id'];
      const userId = req.user?.userId || req.user?.id;

      if (!organizationId) {
        console.error('[Feature Guard] No organization ID found in req.user:', req.user);
        return res.status(401).json({
          success: false,
          error: 'Organization ID required',
          message: 'Unable to verify feature access without organization identification'
        });
      }

      console.log(`[Feature Guard] Checking feature "${featureKey}" for org: ${organizationId}, user: ${userId}`);
      const isEnabled = await featureFlagService.isEnabled(organizationId, featureKey, userId);
      
      console.log(`[Feature Guard] Feature "${featureKey}" enabled: ${isEnabled}`);
      
      if (!isEnabled) {
        return res.status(403).json({
          success: false,
          error: 'Feature not available',
          message: `The ${featureKey} feature is not enabled for your account`,
          feature: featureKey,
          upgrade_required: true
        });
      }

      // Add feature context to request
      req.feature = {
        key: featureKey,
        organizationId,
        userId
      };

      next();
    } catch (error) {
      console.error(`❌ Error checking feature ${featureKey}:`, error);
      
      return res.status(500).json({
        success: false,
        error: 'Feature check failed',
        message: 'Unable to verify feature access at this time'
      });
    }
  };
};

/**
 * Middleware to check multiple features (OR logic - any one enabled)
 */
const requireAnyFeature = (featureKeys) => {
  return async (req, res, next) => {
    try {
      const clientId = req.user?.clientId || req.headers['x-client-id'];
      const userId = req.user?.id;

      if (!clientId) {
        return res.status(401).json({
          success: false,
          error: 'Client ID required'
        });
      }

      // Check if any of the features is enabled
      for (const featureKey of featureKeys) {
        const isEnabled = await featureFlagService.isEnabled(clientId, featureKey, userId);
        if (isEnabled) {
          req.feature = { key: featureKey, clientId, userId };
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        error: 'No required features available',
        message: `None of the required features [${featureKeys.join(', ')}] are enabled for your account`,
        features: featureKeys,
        upgrade_required: true
      });
    } catch (error) {
      console.error('❌ Error checking multiple features:', error);
      return res.status(500).json({
        success: false,
        error: 'Feature check failed'
      });
    }
  };
};

/**
 * Middleware to check multiple features (AND logic - all must be enabled)
 */
const requireAllFeatures = (featureKeys) => {
  return async (req, res, next) => {
    try {
      const clientId = req.user?.clientId || req.headers['x-client-id'];
      const userId = req.user?.id;

      if (!clientId) {
        return res.status(401).json({
          success: false,
          error: 'Client ID required'
        });
      }

      const missingFeatures = [];

      // Check all features
      for (const featureKey of featureKeys) {
        const isEnabled = await featureFlagService.isEnabled(clientId, featureKey, userId);
        if (!isEnabled) {
          missingFeatures.push(featureKey);
        }
      }

      if (missingFeatures.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'Missing required features',
          message: `The following features are required but not enabled: ${missingFeatures.join(', ')}`,
          missing_features: missingFeatures,
          upgrade_required: true
        });
      }

      req.features = featureKeys.map(key => ({ key, clientId, userId }));
      next();
    } catch (error) {
      console.error('❌ Error checking all features:', error);
      return res.status(500).json({
        success: false,
        error: 'Feature check failed'
      });
    }
  };
};

module.exports = {
  requireFeature,
  requireAnyFeature,
  requireAllFeatures
};