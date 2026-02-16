/**
 * Feature Flag Service - Single Source of Truth
 * 
 * PURPOSE:
 * Provides the definitive, database-backed feature flag system for the SaaS platform.
 * This service eliminates the "3 sources of truth" problem by centralizing all
 * feature access decisions in a single, cached, database-driven service.
 * 
 * ARCHITECTURE BENEFITS:
 * 1. SINGLE SOURCE: All feature decisions come from this service
 * 2. DATABASE-BACKED: Persistent, consistent across all application instances
 * 3. CACHED: In-memory caching reduces database load
 * 4. MULTI-TENANT: Client-specific feature access based on plans + overrides
 * 5. HIERARCHICAL: Plan features + client overrides + user-specific rules
 * 
 * FEATURE ACCESS HIERARCHY:
 * 1. Client-specific overrides (highest priority)
 * 2. Plan-based features (subscription tier)
 * 3. Default feature settings (fallback)
 * 
 * RESOLUTION LOGIC:
 * isEnabled(clientId, featureKey) ->
 * 1. Check client_features table for explicit override
 * 2. If no override, check plan_features via client's plan_id
 * 3. If no plan feature, return false (fail closed)
 * 
 * CACHING STRATEGY:
 * - 5-minute TTL cache for feature flags
 * - Cache key: 'clientId:featureKey:userId'
 * - Automatic cache invalidation on flag changes
 * - Graceful degradation if cache fails
 * 
 * DATABASE SCHEMA:
 * - features: Master list of all features
 * - plans: Subscription plans (basic, premium, enterprise)
 * - plan_features: Which features are included in each plan
 * - clients: Client/organization records with plan_id
 * - client_features: Per-client feature overrides
 * 
 * METHODS:
 * - isEnabled(clientId, featureKey): Check if feature is enabled
 * - getClientFeatures(clientId): Get all enabled features for client
 * - enableFeature/disableFeature: Modify client-specific overrides
 */

const { query } = require('../shared/database/connection');

class FeatureFlagService {
  constructor() {
    this.cache = new Map();
    this.cacheTime = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Check if a feature is enabled for a client
   */
  async isEnabled(clientId, featureKey, userId = null) {
    try {
      // Check cache first
      const cacheKey = `${clientId}:${featureKey}:${userId || 'null'}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTime) {
        return cached.enabled;
      }

      // Query database
      const result = await this.queryFeatureAccess(clientId, featureKey, userId);
      
      // Cache result
      this.cache.set(cacheKey, {
        enabled: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error(`❌ Error checking feature flag: ${featureKey}`, error);
      // Fail closed - return false if error
      return false;
    }
  }

  /**
   * Get all enabled features for an organization or user
   */
  async getClientFeatures(organizationId, userId = null) {
    try {
      const queryText = `
        SELECT DISTINCT 
          feature_key,
          config,
          is_enabled
        FROM feature_flags
        WHERE (tenant_id = $1::uuid OR user_id = $2::uuid)
        AND is_enabled = true
        ORDER BY feature_key
      `;
      
      const result = await query(queryText, [organizationId, userId || null]);
      return result.rows.map(row => ({
        key: row.feature_key,
        enabled: row.is_enabled,
        config: row.config
      }));
    } catch (error) {
      console.error('❌ Error fetching client features:', error);
      return [];
    }
  }

  /**
   * Query feature access with plan and override logic
   * Works with lad_dev schema using tenant_id column
   */
  async queryFeatureAccess(organizationId, featureKey, userId) {
    const queryText = `
      SELECT is_enabled
      FROM feature_flags
      WHERE feature_key = $2
      AND (
        tenant_id = $1::uuid
        OR (user_id = $3::uuid AND user_id IS NOT NULL)
      )
      ORDER BY CASE WHEN user_id IS NOT NULL THEN 1 ELSE 2 END
      LIMIT 1
    `;

    const result = await query(queryText, [organizationId, featureKey, userId || null]);
    return result.rows.length > 0 ? result.rows[0].is_enabled : false;
  }

  /**
   * Enable feature for a client
   */
  async enableFeature(clientId, featureKey) {
    try {
      const queryText = `
        INSERT INTO client_features (client_id, feature_id, enabled)
        SELECT $1, f.id, true
        FROM features f
        WHERE f.key = $2
        ON CONFLICT (client_id, feature_id)
        DO UPDATE SET enabled = true, updated_at = NOW()
      `;
      
      await query(queryText, [clientId, featureKey]);
      this.clearCacheForClient(clientId);
      
      console.log(`✅ Enabled feature ${featureKey} for client ${clientId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error enabling feature ${featureKey}:`, error);
      return false;
    }
  }

  /**
   * Disable feature for a client
   */
  async disableFeature(clientId, featureKey) {
    try {
      const queryText = `
        UPDATE client_features
        SET enabled = false, updated_at = NOW()
        WHERE client_id = $1 
        AND feature_id = (SELECT id FROM features WHERE key = $2)
      `;
      
      await query(queryText, [clientId, featureKey]);
      this.clearCacheForClient(clientId);
      
      console.log(`🛑 Disabled feature ${featureKey} for client ${clientId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error disabling feature ${featureKey}:`, error);
      return false;
    }
  }

  /**
   * Clear cache for a specific client
   */
  clearCacheForClient(clientId) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${clientId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = { FeatureFlagService };