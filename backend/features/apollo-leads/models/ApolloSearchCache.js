/**
 * Apollo Search Cache Model
 * LAD Architecture: SQL-free - data shapes, validation, helpers only
 * 
 * This file contains:
 * - Data shape definitions
 * - Validation schemas
 * - Mapping helpers
 * - Constants/enums
 * NO database queries - SQL belongs in repositories
 */

/**
 * Apollo Search Cache Data Shape
 * @typedef {Object} ApolloSearchCacheData
 * @property {string} searchKey - Unique search key (hash of search params)
 * @property {Object} results - Cached search results
 * @property {string} tenantId - Tenant ID (required)
 * @property {string} userId - User ID (required)
 * @property {Object} [metadata] - Metadata JSONB field
 * @property {boolean} [is_deleted] - Soft delete flag
 */

/**
 * Cache TTL constants (in hours)
 */
const CACHE_TTL = {
  DEFAULT: 24,
  SHORT: 1,
  MEDIUM: 12,
  LONG: 48
};

/**
 * Default values for search cache
 */
const DEFAULT_VALUES = {
  metadata: {},
  is_deleted: false,
  hit_count: 1
};

/**
 * Generate cache key from search parameters
 * @param {Object} searchParams - Search parameters
 * @returns {string} Cache key
 */
function generateCacheKey(searchParams) {
  const normalized = {
    keywords: Array.isArray(searchParams.keywords) 
      ? searchParams.keywords.sort().join(',') 
      : searchParams.keywords || '',
    location: searchParams.location || '',
    industry: searchParams.industry || '',
    company_size: searchParams.company_size || '',
    revenue_range: searchParams.revenue_range || '',
    technology: searchParams.technology || '',
    limit: searchParams.limit || 50,
    page: searchParams.page || 1
  };

  // Create a deterministic hash-like key
  const keyString = JSON.stringify(normalized);
  // Simple hash (for production, use crypto.createHash)
  let hash = 0;
  for (let i = 0; i < keyString.length; i++) {
    const char = keyString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return `apollo_search_${Math.abs(hash)}`;
}

/**
 * Map search params to cache data shape
 * @param {Object} searchParams - Search parameters
 * @param {Array} results - Search results
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @returns {ApolloSearchCacheData}
 */
function mapToCacheDataShape(searchParams, results, tenantId, userId) {
  return {
    searchKey: generateCacheKey(searchParams),
    results,
    tenantId,
    userId,
    metadata: DEFAULT_VALUES.metadata,
    is_deleted: DEFAULT_VALUES.is_deleted
  };
}

/**
 * Format cache data for API response
 * @param {Object} dbRow - Database row
 * @returns {Object} Formatted cache object
 */
function formatCacheForResponse(dbRow) {
  return {
    id: dbRow.id,
    search_key: dbRow.search_key,
    results: typeof dbRow.results === 'string' ? JSON.parse(dbRow.results) : dbRow.results,
    hit_count: dbRow.hit_count,
    last_accessed_at: dbRow.last_accessed_at,
    metadata: typeof dbRow.metadata === 'string' ? JSON.parse(dbRow.metadata) : dbRow.metadata,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at
  };
}

/**
 * Validate cache data
 * @param {Object} cacheData - Cache data to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateCacheData(cacheData) {
  const errors = [];

  if (!cacheData.searchKey) {
    errors.push('searchKey is required');
  }
  if (!cacheData.results) {
    errors.push('results is required');
  }
  if (!cacheData.tenantId) {
    errors.push('tenantId is required');
  }
  if (!cacheData.userId) {
    errors.push('userId is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if cache entry is still valid (not expired)
 * @param {Object} cacheEntry - Cache entry from database
 * @param {number} ttlHours - Time to live in hours
 * @returns {boolean} True if cache is still valid
 */
function isCacheValid(cacheEntry, ttlHours = CACHE_TTL.DEFAULT) {
  if (!cacheEntry || !cacheEntry.created_at) {
    return false;
  }

  const cacheDate = new Date(cacheEntry.created_at);
  const now = new Date();
  const hoursDiff = (now - cacheDate) / (1000 * 60 * 60);

  return hoursDiff < ttlHours;
}

module.exports = {
  CACHE_TTL,
  DEFAULT_VALUES,
  generateCacheKey,
  mapToCacheDataShape,
  formatCacheForResponse,
  validateCacheData,
  isCacheValid
};
