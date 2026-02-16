/**
 * Apollo Leads Feature Routes
 * 
 * PURPOSE:
 * Provides Apollo.io lead generation API endpoints with proper feature access
 * control and billing enforcement. This is an OPTIONAL feature that clients
 * access based on their subscription plan.
 * 
 * FEATURE ARCHITECTURE:
 * 1. FEATURE GUARD: All routes require 'apollo-leads' feature access
 * 2. CREDIT GUARD: Billable operations deduct credits automatically
 * 3. SWAGGER DOCS: Self-documenting API with OpenAPI specifications
 * 4. HEALTH CHECKS: Feature-specific health monitoring
 * 
 * API ENDPOINTS:
 * - POST /search: Search companies (free)
 * - GET /companies/:id: Get company details (free)
 * - POST /companies/:id/leads: Get company employees (free)
 * - GET /leads/:id/email: Reveal email + LinkedIn URL (2 credits)
 * - GET /leads/:id/phone: Reveal phone number (10 credits)
 * - GET /health: Feature health status (free)
 * 
 * BILLING ENFORCEMENT:
 * Credit costs are enforced at middleware level:
 * - Email + LinkedIn URL reveals: 2 credits per reveal
 * - Phone reveals: 10 credits per phone
 * 
 * MIDDLEWARE STACK:
 * 1. requireFeature('apollo-leads'): Check feature access
 * 2. requireCredits(type, amount): Check and deduct credits
 * 3. Controller function: Business logic
 * 
 * INTEGRATION:
 * - Uses Apollo service script via LAD_SCRIPTS_PATH environment variable
 * - Script location: backend/shared/services/apollo_service.py (when merged to LAD)
 * - For local dev: Set LAD_SCRIPTS_PATH to scripts directory (symlink setup)
 * - Maintains backward compatibility with existing Apollo implementation
 * - Adds proper access control and billing on top of existing functionality
 * 
 * SECURITY:
 * - Feature access controlled by subscription plan
 * - Credit limits prevent abuse
 * - User authentication required for all endpoints
 * - API rate limiting (implement as needed)
 * 
 * HEALTH MONITORING:
 * /health endpoint checks:
 * - Apollo.io API connectivity
 * - Database connectivity
 * - Feature-specific metrics
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { requireFeature } = require('../../../shared/middleware/feature_guard');
const { requireCredits } = require('../../../shared/middleware/credit_guard');
const ApolloLeadsController = require(path.join(__dirname, '../controllers/ApolloLeadsController'));
const unipileRoutes = require('./unipile');

// Feature guard middleware - all routes require apollo-leads feature
router.use(requireFeature('apollo-leads'));

/**
 * @swagger
 * /api/apollo-leads/search:
 *   post:
 *     summary: Search companies using Apollo.io
 *     tags: [Apollo Leads]
 */
router.post('/search', 
  ApolloLeadsController.searchCompanies
);

/**
 * @swagger
 * /api/apollo-leads/companies/{id}:
 *   get:
 *     summary: Get company details
 *     tags: [Apollo Leads]
 */
router.get('/companies/:id', ApolloLeadsController.getCompanyDetails);

/**
 * @swagger
 * /api/apollo-leads/companies/{id}/leads:
 *   post:
 *     summary: Get leads for a company
 *     tags: [Apollo Leads]
 */
router.post('/companies/:id/leads', ApolloLeadsController.getCompanyLeads);

/**
 * @swagger
 * /api/apollo-leads/leads/{id}/email:
 *   get:
 *     summary: Reveal email for a lead
 *     tags: [Apollo Leads]
 */
router.get('/leads/:id/email', 
  requireCredits('apollo_email', 2),
  ApolloLeadsController.revealEmail
);

/**
 * @swagger
 * /api/apollo-leads/leads/{id}/phone:
 *   get:
 *     summary: Reveal phone for a lead
 *     tags: [Apollo Leads]
 */
router.get('/leads/:id/phone',
  requireCredits('apollo_phone', 10),
  ApolloLeadsController.revealPhone
);

// Additional routes for compatibility
router.post('/bulk-search', ApolloLeadsController.bulkSearchCompanies);
router.get('/search-history', ApolloLeadsController.getSearchHistory);
router.delete('/search-history/:id', ApolloLeadsController.deleteSearchHistory);

/**
 * POST /api/apollo-leads/reveal-email
 * Reveal email - checks database cache first, then calls Apollo API
 * Request body: { person_id: string, employee_name?: string }
 */
router.post('/reveal-email', 
  requireCredits('apollo_email', 2),
  ApolloLeadsController.revealEmail
);

/**
 * POST /api/apollo-leads/reveal-phone
 * Reveal phone - checks database cache first, then calls Apollo API
 * Request body: { person_id: string, employee_name?: string }
 */
router.post('/reveal-phone',
  requireCredits('apollo_phone', 10),
  ApolloLeadsController.revealPhone
);

/**
 * POST /api/apollo-leads/search-employees-from-db
 * Search employees from database cache (employees_cache table)
 * Falls back to Apollo API if no results found in database
 */
router.post('/search-employees-from-db', ApolloLeadsController.searchEmployeesFromDb);

/**
 * POST /api/apollo-leads/webhook/phone-reveal
 * Webhook endpoint for Apollo to deliver phone numbers asynchronously
 * No authentication required - Apollo calls this endpoint
 */
router.post('/webhook/phone-reveal', ApolloLeadsController.handlePhoneRevealWebhook);

/**
 * Feature health check
 */
router.get('/health', async (req, res) => {
  try {
    // Simple health check - no need for manifest
    res.json({
      feature: 'apollo-leads',
      status: 'ok',
      timestamp: new Date().toISOString(),
      endpoints: [
        'POST /search',
        'GET /companies/:id',
        'POST /companies/:id/leads',
        'GET /leads/:id/email',
        'POST /reveal-email',
        'GET /leads/:id/phone',
        'POST /reveal-phone',
        'POST /search-employees-from-db'
      ]
    });
  } catch (error) {
    res.status(500).json({
      feature: 'apollo-leads',
      status: 'error',
      error: error.message
    });
  }
});

// Mount Unipile search routes
router.use('/unipile', unipileRoutes);

module.exports = router;