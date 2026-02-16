/**
 * Apollo Leads Utilities
 * LAD Architecture: Feature-specific utility functions
 * 
 * Contains helper functions specific to Apollo leads feature.
 */

/**
 * Generate cache key for search parameters
 */
function generateSearchCacheKey(searchParams) {
  const normalizedParams = {
    ...searchParams,
    // Sort arrays for consistent keys
    person_titles: searchParams.person_titles ? [...searchParams.person_titles].sort() : [],
    organization_locations: searchParams.organization_locations ? [...searchParams.organization_locations].sort() : [],
    organization_industries: searchParams.organization_industries ? [...searchParams.organization_industries].sort() : []
  };
  
  return Buffer.from(JSON.stringify(normalizedParams)).toString('base64');
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Format US phone numbers
  if (digits.length === 10) {
    return `(${digits.substr(0, 3)}) ${digits.substr(3, 3)}-${digits.substr(6, 4)}`;
  }
  
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.substr(1, 3)}) ${digits.substr(4, 3)}-${digits.substr(7, 4)}`;
  }
  
  // Return original for international numbers
  return phone;
}

/**
 * Extract domain from email
 */
function extractDomainFromEmail(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

/**
 * Check if email domain matches company domain
 */
function isEmailFromCompany(email, companyDomain) {
  if (!email || !companyDomain) return false;
  
  const emailDomain = extractDomainFromEmail(email);
  if (!emailDomain) return false;
  
  return emailDomain === companyDomain.toLowerCase();
}

/**
 * Sanitize search query for SQL LIKE operations
 */
function sanitizeSearchQuery(query) {
  if (!query) return '';
  
  // Escape SQL wildcards and special characters
  return query
    .replace(/[%_\\]/g, '\\$&')
    .trim()
    .toLowerCase();
}

module.exports = {
  generateSearchCacheKey,
  formatPhoneNumber,
  extractDomainFromEmail,
  isEmailFromCompany,
  sanitizeSearchQuery
};