/**
 * Apollo Company Model
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
 * Apollo Company Data Shape
 * @typedef {Object} ApolloCompanyData
 * @property {string} apolloId - Apollo.io company ID
 * @property {string} name - Company name
 * @property {string} [domain] - Company domain
 * @property {string} [industry] - Industry
 * @property {number} [employeeCount] - Employee count
 * @property {string} [revenue] - Revenue
 * @property {Object} [location] - Location data
 * @property {string} [phone] - Phone number
 * @property {string} [website] - Website URL
 * @property {Object} [enrichedData] - Additional enriched data
 * @property {string} tenantId - Tenant ID (required)
 * @property {string} userId - User ID (required)
 * @property {Object} [metadata] - Metadata JSONB field
 * @property {boolean} [is_deleted] - Soft delete flag
 */

/**
 * Default values for Apollo Company
 */
const DEFAULT_VALUES = {
  metadata: {},
  is_deleted: false
};

/**
 * Map Apollo.io API response to our company data shape
 * @param {Object} apolloCompany - Raw Apollo.io company object
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @returns {ApolloCompanyData}
 */
function mapApolloCompanyToDataShape(apolloCompany, tenantId, userId) {
  return {
    apolloId: apolloCompany.id,
    name: apolloCompany.name,
    domain: apolloCompany.primary_domain || apolloCompany.domain,
    industry: apolloCompany.primary_vertical || apolloCompany.industry,
    employeeCount: apolloCompany.num_current_employees || apolloCompany.employee_count,
    revenue: apolloCompany.estimated_revenue || apolloCompany.revenue,
    location: {
      country: apolloCompany.organization_raw_address_country,
      city: apolloCompany.organization_raw_address_city,
      state: apolloCompany.organization_raw_address_state
    },
    phone: apolloCompany.phone_number || apolloCompany.phone,
    website: apolloCompany.website_url || apolloCompany.website,
    enrichedData: apolloCompany,
    tenantId,
    userId,
    metadata: DEFAULT_VALUES.metadata,
    is_deleted: DEFAULT_VALUES.is_deleted
  };
}

/**
 * Format company data for API response
 * @param {Object} dbRow - Database row
 * @returns {Object} Formatted company object
 */
function formatCompanyForResponse(dbRow) {
  return {
    id: dbRow.id,
    apollo_id: dbRow.apollo_id,
    name: dbRow.name,
    domain: dbRow.domain,
    industry: dbRow.industry,
    employee_count: dbRow.employee_count,
    revenue: dbRow.revenue,
    location: typeof dbRow.location === 'string' ? JSON.parse(dbRow.location) : dbRow.location,
    phone: dbRow.phone,
    website: dbRow.website,
    enriched_data: typeof dbRow.enriched_data === 'string' ? JSON.parse(dbRow.enriched_data) : dbRow.enriched_data,
    metadata: typeof dbRow.metadata === 'string' ? JSON.parse(dbRow.metadata) : dbRow.metadata,
    created_at: dbRow.created_at,
    updated_at: dbRow.updated_at
  };
}

/**
 * Validate company data
 * @param {Object} companyData - Company data to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateCompanyData(companyData) {
  const errors = [];

  if (!companyData.apolloId) {
    errors.push('apolloId is required');
  }
  if (!companyData.name) {
    errors.push('name is required');
  }
  if (!companyData.tenantId) {
    errors.push('tenantId is required');
  }
  if (!companyData.userId) {
    errors.push('userId is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  DEFAULT_VALUES,
  mapApolloCompanyToDataShape,
  formatCompanyForResponse,
  validateCompanyData
};
