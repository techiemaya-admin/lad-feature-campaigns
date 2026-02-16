/**
 * Apollo Leads Service
 * LAD Architecture Compliant - Main service for Apollo.io lead generation
 * 
 * Coordinates between various specialized services:
 * - ApolloRevealService: Email and phone reveals
 * - ApolloFormatterService: Data formatting
 * - ApolloSearchHistoryService: Search history
 * - ApolloCacheService: Database cache operations
 */

const axios = require('axios');
const ApolloFormatterService = require('./ApolloFormatterService');
const ApolloPythonService = require('./ApolloPythonService');
const ApolloRevealService = require('./ApolloRevealService');
const { APOLLO_CONFIG, TIMEOUT_CONFIG } = require('../constants/constants');
const logger = require('../../../core/utils/logger');

class ApolloLeadsService {
  constructor() {
    this.apiKey = process.env.APOLLO_API_KEY || process.env.APOLLO_IO_API_KEY;
    // LAD Architecture: Use environment variable for API base URL
    // Apollo.io API v1 base URL: https://api.apollo.io/v1
    this.baseURL = process.env.APOLLO_API_BASE_URL || APOLLO_CONFIG.DEFAULT_BASE_URL;
    
    // Initialize reveal service
    this.revealService = new ApolloRevealService(this.apiKey, this.baseURL);
    
    if (!this.apiKey) {
      logger.warn('[Apollo Leads Service] Apollo API key not configured');
    }
    
    logger.debug('[Apollo Leads Service] Initialized', {
      baseURL: this.baseURL,
      hasApiKey: !!this.apiKey
    });
  }

  /**
   * Search companies using Apollo.io
   * @param {Object} searchParams - Search parameters
   * @param {Object} req - Express request object (for tenant context)
   */
  async searchCompanies(searchParams, req = null) {
    const {
      keywords = [],
      industry,
      location,
      company_size,
      revenue_range,
      technology,
      limit = 50,
      page = 1
    } = searchParams;

    try {
      const mainKeyword = keywords.length > 0 ? keywords[0] : '';
      
      const payload = {
        // Apollo.io API: Prefer X-Api-Key header over api_key in body
        // Remove api_key from body when using header to avoid conflicts
        q_organization_name: mainKeyword,
        page: page,
        per_page: Math.min(limit, APOLLO_CONFIG.MAX_PER_PAGE)
      };

      // Apollo.io API parameter format for /mixed_companies/search:
      // - organization_locations: Array of location strings (e.g., ["San Francisco, CA", "New York, NY"])
      // - organization_industries: Array of industry name strings (e.g., ["Software", "Technology"])
      //   Note: industry_tag_ids is for numeric tag IDs, but organization_industries is more common for names
      // - organization_num_employees_ranges: Array of employee range strings
      
      if (industry) {
        // Support both array and single value
        const industryValue = Array.isArray(industry) ? industry : [industry];
        // Check if first value is a numeric string (tag ID) or text (industry name)
        const firstValue = String(industryValue[0] || '');
        const isNumeric = /^\d+$/.test(firstValue.trim()); // Only digits
        
        if (isNumeric) {
          // Numeric tag IDs - use industry_tag_ids
          payload.industry_tag_ids = industryValue.map(id => parseInt(id));
        } else {
          // Text industry names - use organization_industries (preferred for company search)
          payload.organization_industries = industryValue;
        }
      }
      
      if (location) {
        // organization_locations must be an array of location strings
        // Format: ["City, State", "City, Country", etc.]
        payload.organization_locations = Array.isArray(location) ? location : [location];
      }
      
      if (company_size) {
        // organization_num_employees_ranges must be an array
        payload.organization_num_employees_ranges = Array.isArray(company_size) ? company_size : [company_size];
      }

      // Log payload for debugging (remove sensitive data in production)
      logger.debug('[Apollo Leads] API request payload', {
        url: `${this.baseURL}${APOLLO_CONFIG.ENDPOINTS.ORGANIZATIONS_SEARCH}`,
        payload: { ...payload, hasApiKey: !!this.apiKey }
      });

      const response = await axios.post(
        `${this.baseURL}${APOLLO_CONFIG.ENDPOINTS.ORGANIZATIONS_SEARCH}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey
          },
          timeout: TIMEOUT_CONFIG.APOLLO_API
        }
      );

      const companies = response.data.organizations || [];
      
      logger.debug('[Apollo Leads] API response', {
        companiesFound: companies.length,
        hasPagination: !!response.data.pagination
      });
      
      // Save search to history (if req context available)
      if (req) {
        try {
          const ApolloSearchHistoryService = require('./ApolloSearchHistoryService');
          await ApolloSearchHistoryService.saveSearchHistory({
            searchParams,
            results: companies.length,
            userId: req.user?.id || 'system'
          }, req);
        } catch (historyError) {
          logger.warn('[Apollo Leads] Failed to save search history', { error: historyError.message });
        }
      }

      return ApolloFormatterService.formatCompanies(companies);
    } catch (error) {
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        method: error.config?.method
      };
      logger.error('[Apollo Leads] Apollo API error', errorDetails);
      
      // Provide more helpful error message for parameter issues
      if (error.response?.status === 422) {
        const errorMsg = error.response?.data?.error || error.message;
        throw new Error(`Apollo search failed: ${errorMsg}. Check that industry/location parameters are formatted correctly.`);
      }
      
      throw new Error(`Apollo search failed: ${error.message}`);
    }
  }

  /**
   * Get company details by ID
   */
  async getCompanyById(companyId) {
    try {
      const response = await axios.get(
        `${this.baseURL}${APOLLO_CONFIG.ENDPOINTS.ORGANIZATION_BY_ID}/${companyId}`,
        {
          headers: { 'X-Api-Key': this.apiKey }
        }
      );

      return ApolloFormatterService.formatCompany(response.data.organization);
    } catch (error) {
      logger.error('[Apollo Leads] Get company error', { error: error.message, stack: error.stack });
      throw new Error(`Failed to get company: ${error.message}`);
    }
  }

  /**
   * Get company leads (employees)
   */
  async getCompanyLeads(companyId, options = {}) {
    const { limit = 25, page = 1, title_filter } = options;

    try {
      const payload = {
        q_organization_ids: [companyId],
        page,
        per_page: limit
      };

      if (title_filter) {
        payload.q_person_titles = [title_filter];
      }

      const response = await axios.post(
        `${this.baseURL}${APOLLO_CONFIG.ENDPOINTS.PEOPLE_SEARCH}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey
          }
        }
      );

      return ApolloFormatterService.formatLeads(response.data.people || []);
    } catch (error) {
      logger.error('[Apollo Leads] Get leads error', { error: error.message, stack: error.stack });
      throw new Error(`Failed to get leads: ${error.message}`);
    }
  }

  /**
   * Reveal email - delegates to ApolloRevealService
   */
  async revealEmail(personId, employeeName = null, req = null) {
    return this.revealService.revealEmail(personId, employeeName, req);
  }
  
  /**
   * Reveal phone - delegates to ApolloRevealService
   */
  async revealPhone(personId, employeeName = null, req = null) {
    return this.revealService.revealPhone(personId, employeeName, req);
  }

  /**
   * Search history methods - delegate to ApolloSearchHistoryService
   */
  async saveSearchHistory(searchData, req = null) {
    const ApolloSearchHistoryService = require('./ApolloSearchHistoryService');
    return ApolloSearchHistoryService.saveSearchHistory(searchData, req);
  }

  async getSearchHistory(userId, options = {}, req = null) {
    const ApolloSearchHistoryService = require('./ApolloSearchHistoryService');
    return ApolloSearchHistoryService.getSearchHistory(userId, options, req);
  }

  async deleteSearchHistory(historyId, userId, req = null) {
    const ApolloSearchHistoryService = require('./ApolloSearchHistoryService');
    return ApolloSearchHistoryService.deleteSearchHistory(historyId, userId, req);
  }

  /**
   * Format methods - delegate to ApolloFormatterService
   */
  formatCompanies(companies) {
    return ApolloFormatterService.formatCompanies(companies);
  }

  formatCompany(company) {
    return ApolloFormatterService.formatCompany(company);
  }

  formatLeads(people) {
    return ApolloFormatterService.formatLeads(people);
  }

  /**
   * Call Python Apollo service - delegate to ApolloPythonService
   */
  _callApolloService(method, params = {}) {
    return ApolloPythonService.callApolloService(method, params);
  }

  /**
   * Search employees from database cache
   * Delegates to ApolloCacheService
   */
  async searchEmployeesFromDb(searchParams, req = null) {
    const { searchEmployeesFromDb } = require('./ApolloCacheService');
    return searchEmployeesFromDb(searchParams, req);
  }

  /**
   * Handle webhook callback from Apollo for phone number reveal
   */
  async handlePhoneRevealWebhook(webhookData) {
    return this.revealService.handlePhoneRevealWebhook(webhookData);
  }
}

module.exports = new ApolloLeadsService();
