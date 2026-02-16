/**
 * Apollo Leads Feature Constants
 * Feature-specific configuration constants
 */

// Apollo.io API Configuration
const APOLLO_CONFIG = {
  DEFAULT_BASE_URL: 'https://api.apollo.io/v1',
  MAX_PER_PAGE: 100,
  // Set to true if your API key doesn't have access to people search endpoints
  // This will skip people search API calls and rely on database cache only
  SKIP_PEOPLE_SEARCH_API: process.env.APOLLO_SKIP_PEOPLE_SEARCH === 'true',
  ENDPOINTS: {
    ORGANIZATIONS_SEARCH: '/organizations/search',
    ORGANIZATION_BY_ID: '/organizations',
    PEOPLE_SEARCH: '/mixed_people/api_search',
    PEOPLE_BULK_MATCH: '/people/bulk_match',
    MIXED_PEOPLE_SEARCH: '/mixed_people/api_search',
    PEOPLE_MATCH: '/people/match',
    PEOPLE_ENRICHMENT: '/people/match',
    BULK_PEOPLE_ENRICHMENT: '/people/bulk_match',
    ORGANIZATION_ENRICHMENT: '/organizations/enrich'
  }
};

// Cache Configuration
const CACHE_CONFIG = {
  FAKE_EMAIL_PATTERNS: [
    'noemail',
    'no-email',
    'unavailable',
    'not-available',
    'not_unlocked',
    'email_not_unlocked',
    'private',
    'hidden',
    'contact@',
    'info@',
    'admin@',
    'support@',
    'hello@',
    'example.com',
    'test.com',
    'sample.com'
  ]
};

// Credit Costs for billable operations
const CREDIT_COSTS = {
  EMAIL_REVEAL: 2,           // Email + LinkedIn URL: 2 credits
  LINKEDIN_CONNECTION: 1,    // LinkedIn connection: 1 credit
  TEMPLATE_MESSAGE: 5,       // Each template message: 5 credits
  PHONE_REVEAL: 10           // Phone reveal: 10 credits
};

// Timeout Configuration
const TIMEOUT_CONFIG = {
  DEFAULT: 30000,
  APOLLO_API: 45000,
  DATABASE: 15000
};

module.exports = {
  APOLLO_CONFIG,
  CACHE_CONFIG,
  CREDIT_COSTS,
  TIMEOUT_CONFIG
};
