/**
 * Apollo Leads Input Validators
 * LAD Architecture: Input validation functions only
 * 
 * Validates request parameters and data for Apollo leads operations.
 */

/**
 * Validate company search parameters
 */
function validateCompanySearchParams(params) {
  const errors = [];
  
  if (params.limit && (params.limit < 1 || params.limit > 100)) {
    errors.push('Limit must be between 1 and 100');
  }
  
  if (params.page && params.page < 1) {
    errors.push('Page must be greater than 0');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate employee search parameters
 */
function validateEmployeeSearchParams(params) {
  const errors = [];
  const { organization_locations = [], person_titles = [], organization_industries = [] } = params;
  
  const hasPersonTitles = person_titles && person_titles.length > 0;
  const hasIndustries = organization_industries && organization_industries.length > 0;
  const hasLocations = organization_locations && organization_locations.length > 0;
  
  if (!hasPersonTitles && !hasIndustries && !hasLocations) {
    errors.push('At least one search criteria is required (person_titles, organization_industries, or organization_locations)');
  }
  
  if (params.per_page && (params.per_page < 1 || params.per_page > 100)) {
    errors.push('per_page must be between 1 and 100');
  }
  
  if (params.page && params.page < 1) {
    errors.push('page must be greater than 0');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate reveal parameters
 */
function validateRevealParams(params) {
  const errors = [];
  
  if (!params.person_id && !params.employee_name) {
    errors.push('Either person_id or employee_name is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateCompanySearchParams,
  validateEmployeeSearchParams,
  validateRevealParams
};