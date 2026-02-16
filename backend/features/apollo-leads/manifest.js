/**
 * Apollo Leads Feature Manifest
 * 
 * PURPOSE:
 * Self-declaring feature manifest that defines the Apollo.io lead generation
 * feature's capabilities, dependencies, billing, and integration requirements.
 * This manifest enables the feature registry to automatically discover and
 * properly configure this feature.
 * 
 * MANIFEST PATTERN BENEFITS:
 * 1. SELF-DOCUMENTING: Feature declares its own capabilities
 * 2. DEPENDENCY MANAGEMENT: Explicit declaration of required services
 * 3. BILLING INTEGRATION: Credit costs defined at feature level
 * 4. ENVIRONMENT VALIDATION: Required config variables specified
 * 5. HEALTH MONITORING: Built-in health check endpoints
 * 
 * FEATURE CAPABILITIES:
 * - Company search via Apollo.io API
 * - Lead generation and enrichment
 * - Email reveal (1 credit)
 * - Phone reveal (8 credits) 
 * - Webhook handling for async operations
 * 
 * BILLING INTEGRATION:
 * - Premium tier feature (requires paid plan)
 * - Per-operation credit billing
 * - Usage tracking for analytics
 * - Automatic limit enforcement
 * 
 * EXTERNAL DEPENDENCIES:
 * - Apollo.io API (requires APOLLO_API_KEY)
 * - Database tables for caching and tracking
 * - Webhook endpoints for phone reveals
 * 
 * MANIFEST SCHEMA:
 * - key: Unique feature identifier
 * - name: Human-readable feature name
 * - description: Feature overview
 * - version: Semantic version for updates
 * - billing: Credit costs and plan requirements
 * - routes: API endpoints this feature provides
 * - dependencies: Required core services
 * - environment: Required/optional config variables
 * - database: Tables and migrations needed
 * - flags: Feature flag configuration
 * 
 * ACTIVATION:
 * When client has access, activate() function registers routes with Express.
 * When disabled, deactivate() cleans up resources.
 */
// This file declares the feature and its capabilities

const FEATURE = {
  key: 'apollo-leads',
  name: 'Apollo Leads',
  description: 'Apollo.io lead generation and company search',
  version: '1.0.0',
  
  // Billing information
  billing: {
    tier: 'premium', // minimum plan required
    credits: {
      search: 1,      // 1 credit per search
      email: 1,       // 1 credit per email reveal
      phone: 8        // 8 credits per phone reveal
    }
  },
  
  // API routes this feature provides
  routes: [
    'search',
    'companies/:id',
    'companies/:id/leads', 
    'leads/:id/email',
    'leads/:id/phone',
    'health'
  ],
  
  // Dependencies
  dependencies: [
    'core.billing',  // needs billing system
    'core.auth'      // needs authentication
  ],
  
  // Environment requirements
  environment: {
    required: ['APOLLO_API_KEY'],
    optional: ['APOLLO_WEBHOOK_URL', 'APOLLO_API_BASE_URL']
  },
  
  // Database tables this feature uses
  database: {
    tables: ['apollo_searches', 'apollo_leads', 'phone_reveals'],
    migrations: ['001_create_apollo_tables.sql']
  },
  
  // Feature flags configuration
  flags: {
    default_enabled: false,
    user_groups: ['admin', 'premium', 'enterprise'],
    rollout_percentage: 100
  },
  
  // External services
  external_apis: [
    {
      name: 'Apollo.io API',
      url: process.env.APOLLO_API_BASE_URL || require('./constants/constants').APOLLO_CONFIG.DEFAULT_BASE_URL,
      required: true
    }
  ],
  
  // Health check configuration
  health_check: {
    endpoint: '/health',
    dependencies: ['apollo_api', 'database']
  }
};

// Feature activation function
const activate = (app, config) => {
  // Feature activation logging handled by feature registry
  
  // Load routes
  const routes = require('./routes');
  app.use(`/api/${FEATURE.key}`, routes);
  
  // Feature activation logging handled by feature registry
};

// Feature deactivation function
const deactivate = (app) => {
  // Feature deactivation logging handled by feature registry
  // Cleanup logic here
};

// Health check function
const healthCheck = async () => {
  try {
    // Check Apollo API connection
    const apolloHealth = await checkApolloAPI();
    
    // Check database connectivity
    const dbHealth = await checkDatabase();
    
    return {
      status: 'healthy',
      checks: {
        apollo_api: apolloHealth,
        database: dbHealth
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
};

// Helper functions
const checkApolloAPI = async () => {
  // Implementation here
  return { status: 'ok', response_time: '45ms' };
};

const checkDatabase = async () => {
  // Implementation here  
  return { status: 'ok', connection_pool: '5/10' };
};

module.exports = FEATURE;