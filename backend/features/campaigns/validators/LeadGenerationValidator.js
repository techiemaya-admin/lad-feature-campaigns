/**
 * Lead Generation Validator
 * Input validation for lead generation parameters
 * LAD Architecture: Separate validation layer from business logic
 */

const logger = require('../../../core/utils/logger');

class LeadGenerationValidator {
  /**
   * Validate daily lead limit
   * @param {number} dailyLimit - Daily lead limit
   * @returns {Object} { isValid: boolean, error: string|null }
   */
  static validateDailyLimit(dailyLimit) {
    if (!dailyLimit || typeof dailyLimit !== 'number') {
      return {
        isValid: false,
        error: 'leads_per_day must be a number'
      };
    }

    if (dailyLimit <= 0) {
      return {
        isValid: false,
        error: 'leads_per_day must be greater than 0'
      };
    }

    if (dailyLimit > 1000) {
      return {
        isValid: false,
        error: 'leads_per_day cannot exceed 1000 (maximum daily limit)'
      };
    }

    return { isValid: true, error: null };
  }

  /**
   * Validate lead generation filters
   * @param {Object} filters - Filter object (person_titles, organization_locations, etc.)
   * @param {Object} stepConfig - Step configuration (for Apollo API format filters)
   * @returns {Object} { isValid: boolean, error: string|null, normalizedFilters: Object }
   */
  static validateFilters(filters = {}, stepConfig = {}) {
    // Check old format in filters object
    const hasOldRoles = filters.roles && Array.isArray(filters.roles) && filters.roles.length > 0;
    const hasOldLocation = filters.location && (
      (typeof filters.location === 'string' && filters.location.trim().length > 0) ||
      (Array.isArray(filters.location) && filters.location.length > 0)
    );
    const hasOldIndustries = filters.industries && Array.isArray(filters.industries) && filters.industries.length > 0;
    
    // Check Apollo format in filters object
    const hasRoles = filters.person_titles && filters.person_titles.length > 0;
    const hasLocation = filters.organization_locations && filters.organization_locations.length > 0;
    const hasIndustries = filters.organization_industries && filters.organization_industries.length > 0;
    
    // Check for Apollo API format filters directly in stepConfig
    const hasApolloKeywords = stepConfig.q_organization_keyword_tags && stepConfig.q_organization_keyword_tags.length > 0;
    const hasApolloEmployeeRanges = stepConfig.organization_num_employees_ranges && stepConfig.organization_num_employees_ranges.length > 0;
    const hasApolloTitles = stepConfig.person_titles && stepConfig.person_titles.length > 0;
    const hasApolloLocations = stepConfig.organization_locations && stepConfig.organization_locations.length > 0;
    const hasApolloIndustries = stepConfig.organization_industries && stepConfig.organization_industries.length > 0;
    
    // At least one filter criterion must be provided
    if (!hasOldRoles && !hasOldLocation && !hasOldIndustries && 
        !hasRoles && !hasLocation && !hasIndustries && 
        !hasApolloKeywords && !hasApolloEmployeeRanges && 
        !hasApolloTitles && !hasApolloLocations && !hasApolloIndustries) {
      return {
        isValid: false,
        error: 'Lead generation filter not configured. Please set at least one of: roles, location, or industries',
        normalizedFilters: {}
      };
    }

    // Normalize filters to Apollo format
    const normalizedFilters = {};

    // Handle person_titles/roles
    if (hasOldRoles) {
      normalizedFilters.person_titles = Array.isArray(filters.roles) ? filters.roles : [filters.roles];
    } else if (hasRoles) {
      normalizedFilters.person_titles = Array.isArray(filters.person_titles) ? filters.person_titles : [filters.person_titles];
    } else if (hasApolloTitles) {
      normalizedFilters.person_titles = stepConfig.person_titles;
    }
    
    // Handle organization_locations/location
    if (hasOldLocation) {
      if (typeof filters.location === 'string') {
        normalizedFilters.organization_locations = [filters.location];
      } else if (Array.isArray(filters.location)) {
        normalizedFilters.organization_locations = filters.location;
      }
    } else if (hasLocation) {
      normalizedFilters.organization_locations = Array.isArray(filters.organization_locations) 
        ? filters.organization_locations 
        : [filters.organization_locations];
    } else if (hasApolloLocations) {
      normalizedFilters.organization_locations = stepConfig.organization_locations;
    }
    
    // Handle organization_industries/industries
    if (hasOldIndustries) {
      normalizedFilters.organization_industries = Array.isArray(filters.industries) ? filters.industries : [filters.industries];
    } else if (hasIndustries) {
      normalizedFilters.organization_industries = Array.isArray(filters.organization_industries) 
        ? filters.organization_industries 
        : [filters.organization_industries];
    } else if (hasApolloIndustries) {
      normalizedFilters.organization_industries = stepConfig.organization_industries;
    }
    
    // Map Apollo API specific filters to expected format
    if (hasApolloKeywords && !normalizedFilters.organization_industries) {
      normalizedFilters.organization_industries = stepConfig.q_organization_keyword_tags;
    }
    
    if (hasApolloEmployeeRanges) {
      normalizedFilters.organization_num_employees_ranges = stepConfig.organization_num_employees_ranges;
    }

    return {
      isValid: true,
      error: null,
      normalizedFilters
    };
  }

  /**
   * Validate search parameters
   * @param {Object} searchParams - Search parameters object
   * @returns {Object} { isValid: boolean, error: string|null }
   */
  static validateSearchParams(searchParams) {
    if (!searchParams || typeof searchParams !== 'object') {
      return {
        isValid: false,
        error: 'Search parameters must be an object'
      };
    }

    // Validate per_page
    if (searchParams.per_page && (typeof searchParams.per_page !== 'number' || searchParams.per_page <= 0)) {
      return {
        isValid: false,
        error: 'per_page must be a positive number'
      };
    }

    // Validate page
    if (searchParams.page && (typeof searchParams.page !== 'number' || searchParams.page <= 0)) {
      return {
        isValid: false,
        error: 'page must be a positive number'
      };
    }

    // Validate tenant_id
    if (searchParams.tenant_id && typeof searchParams.tenant_id !== 'string') {
      return {
        isValid: false,
        error: 'tenant_id must be a string'
      };
    }

    // Validate exclude_ids
    if (searchParams.exclude_ids && !Array.isArray(searchParams.exclude_ids)) {
      return {
        isValid: false,
        error: 'exclude_ids must be an array'
      };
    }

    return { isValid: true, error: null };
  }

  /**
   * Validate complete lead generation request
   * @param {Object} params - All lead generation parameters
   * @returns {Object} { isValid: boolean, errors: string[] }
   */
  static validateLeadGenerationRequest(params) {
    const errors = [];

    // Required fields
    if (!params.campaignId) {
      errors.push('campaignId is required');
    }
    if (!params.tenantId) {
      errors.push('tenantId is required');
    }
    if (!params.stepConfig) {
      errors.push('stepConfig is required');
    }

    // Validate daily limit
    if (params.dailyLimit) {
      const dailyLimitValidation = this.validateDailyLimit(params.dailyLimit);
      if (!dailyLimitValidation.isValid) {
        errors.push(dailyLimitValidation.error);
      }
    }

    // Validate filters
    if (params.filters || params.stepConfig) {
      const filterValidation = this.validateFilters(params.filters, params.stepConfig);
      if (!filterValidation.isValid) {
        errors.push(filterValidation.error);
      }
    }

    // Validate search params
    if (params.searchParams) {
      const searchValidation = this.validateSearchParams(params.searchParams);
      if (!searchValidation.isValid) {
        errors.push(searchValidation.error);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = LeadGenerationValidator;
