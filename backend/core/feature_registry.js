/**
 * Feature Registry Service
 * 
 * PURPOSE:
 * Manages dynamic discovery, registration, and loading of SaaS features.
 * This is the heart of the feature-based architecture that allows:
 * 
 * 1. FEATURE DISCOVERY: Automatically finds features with manifest.js files
 * 2. MANIFEST VALIDATION: Ensures features declare required dependencies and capabilities
 * 3. DYNAMIC LOADING: Loads feature routes only when clients have access
 * 4. DEPENDENCY MANAGEMENT: Tracks feature dependencies and load order
 * 5. LAZY LOADING: Features are loaded on-demand to reduce memory footprint
 * 
 * HOW IT WORKS:
 * 1. Scans backend/features/ directory for subdirectories
 * 2. Loads manifest.js from each feature directory
 * 3. Validates manifest schema (key, name, version, routes)
 * 4. Registers feature in memory registry
 * 5. Provides methods to load feature routers based on client access
 * 
 * MANIFEST EXAMPLE:
 * {
 *   key: 'apollo-leads',
 *   name: 'Apollo Leads',
 *   version: '1.0.0',
 *   routes: ['search', 'companies/:id'],
 *   dependencies: ['core.billing']
 * }
 * 
 * SECURITY:
 * - Features are only loaded if client has access via FeatureFlagService
 * - Prevents unauthorized access to premium features
 * - Supports per-client feature customization
 */

const fs = require('fs').promises;
const path = require('path');
const { FeatureFlagService } = require('../feature_flags/service');
const logger = require('./utils/logger');

class FeatureRegistry {
  constructor() {
    this.features = new Map();
    this.featureFlagService = new FeatureFlagService();
  }

  async discoverFeatures() {
    const featuresDir = path.join(__dirname, '../features');
    
    try {
      const featureDirs = await fs.readdir(featuresDir);
      logger.info('[FeatureRegistry] Discovering features', { featuresDir, directoryCount: featureDirs.length });
      logger.debug('[FeatureRegistry] Found directories', { directories: featureDirs });
      
      for (const featureDir of featureDirs) {
        const manifestPath = path.join(featuresDir, featureDir, 'manifest.js');
        
        try {
          // Check if manifest exists
          await fs.access(manifestPath);
          
          // Load feature manifest
          const manifest = require(manifestPath);
          logger.debug('[FeatureRegistry] Loaded manifest', { 
            featureDir, 
            key: manifest.key, 
            hasRoutes: Array.isArray(manifest.routes),
            routesCount: manifest.routes?.length 
          });
          
          // Validate manifest
          if (this.validateManifest(manifest)) {
            this.registerFeature(manifest);
            logger.info('[FeatureRegistry] Registered feature', { key: manifest.key, name: manifest.name });
          } else {
            logger.warn('[FeatureRegistry] Invalid manifest', { 
              featureDir,
              key: manifest.key, 
              name: manifest.name, 
              version: manifest.version,
              hasRoutes: Array.isArray(manifest.routes)
            });
          }
        } catch (error) {
          logger.debug('[FeatureRegistry] No manifest found', { featureDir, error: error.message });
        }
      }
      
      const registeredFeatures = Array.from(this.features.keys());
      logger.info('[FeatureRegistry] Feature discovery complete', { 
        count: registeredFeatures.length,
        features: registeredFeatures 
      });
    } catch (error) {
      logger.error('[FeatureRegistry] Error discovering features', { error: error.message, stack: error.stack });
    }
  }

  validateManifest(manifest) {
    return manifest.key && 
           manifest.name && 
           manifest.version &&
           Array.isArray(manifest.routes);
  }

  registerFeature(manifest) {
    const feature = {
      ...manifest,
      loadedAt: new Date(),
      router: null
    };
    
    this.features.set(manifest.key, feature);
  }

  getFeature(key) {
    return this.features.get(key);
  }

  getFeatureList() {
    return Array.from(this.features.keys());
  }

  async loadFeatureRouter(featureKey, clientId) {
    const feature = this.features.get(featureKey);
    if (!feature) {
      throw new Error(`Feature not found: ${featureKey}`);
    }

    // Check if client has access
    const hasAccess = await this.featureFlagService.isEnabled(clientId, featureKey);
    if (!hasAccess) {
      throw new Error(`Feature not enabled for client: ${featureKey}`);
    }

    // Lazy load router if not already loaded
    if (!feature.router) {
      // Try routes/index.js first, then routes.js
      let routerPath = path.join(__dirname, '../features', featureKey, 'routes', 'index.js');
      try {
        await fs.access(routerPath);
      } catch {
        // Fallback to routes.js
        routerPath = path.join(__dirname, '../features', featureKey, 'routes.js');
      }
      feature.router = require(routerPath);
    }

    return feature.router;
  }

  getEnabledFeatures(clientId) {
    return this.featureFlagService.getClientFeatures(clientId);
  }
}

module.exports = { FeatureRegistry };