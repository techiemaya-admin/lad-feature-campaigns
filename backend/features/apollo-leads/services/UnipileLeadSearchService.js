/**
 * Unipile Lead & Company Search Service
 * 
 * Searches for companies and leads directly from Unipile/LinkedIn
 * using industry, location, and designation filters.
 * 
 * This is an alternative to Apollo's people_api and provides
 * access to real LinkedIn data through Unipile integration.
 */

const axios = require('axios');
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class UnipileLeadSearchService {
  constructor() {
    this.unipileDsn = process.env.UNIPILE_DSN;
    this.unipileToken = process.env.UNIPILE_TOKEN;
    
    if (!this.isConfigured()) {
      logger.warn('[Unipile Lead Search] UNIPILE_DSN or UNIPILE_TOKEN not configured');
    }
  }

  /**
   * Check if Unipile is configured
   */
  isConfigured() {
    return !!(this.unipileDsn && this.unipileToken);
  }

  /**
   * Get base URL for Unipile API
   * According to Unipile docs: https://{YOUR_DSN}/api/v1/...
   * DSN includes hostname and port (e.g., api8.unipile.com:13811)
   */
  getBaseUrl() {
    if (!this.unipileDsn) {
      throw new Error('UNIPILE_DSN not configured');
    }

    let dsn = this.unipileDsn.trim();
    
    // Add https:// if not present
    if (!dsn.startsWith('http://') && !dsn.startsWith('https://')) {
      dsn = `https://${dsn}`;
    }
    
    // Remove trailing slashes
    dsn = dsn.replace(/\/+$/, '');
    
    // Add /api/v1 path
    if (!dsn.includes('/api/v1')) {
      dsn = `${dsn}/api/v1`;
    }
    
    return dsn;
  }

  /**
   * Get authentication headers
   * According to Unipile docs: X-API-KEY header with Access Token
   */
  getAuthHeaders() {
    if (!this.unipileToken) {
      throw new Error('UNIPILE_TOKEN not configured');
    }
    return {
      'X-API-KEY': this.unipileToken,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Search companies on LinkedIn via Unipile
   * 
   * @param {Object} params - Search parameters
   * @param {string} params.keywords - Search keywords (e.g., "technology")
   * @param {string|Array} params.industry - Industry ID(s) (e.g., "4" for Technology)
   * @param {string|Array} params.location - Location ID(s) or string to lookup
   * @param {number} params.limit - Max results (default: 50)
   * @param {string} params.accountId - Unipile LinkedIn account ID (required)
   * @returns {Promise<Object>} Search results
   */
  async searchCompanies(params) {
    try {
      const { keywords, industry, location, limit = 50, accountId } = params;

      if (!accountId) {
        throw new Error('accountId is required to search companies');
      }

      if (!keywords && !industry && !location) {
        throw new Error('At least one search filter (keywords, industry, location) is required');
      }

      logger.info('[Unipile Company Search] Searching companies', {
        keywords,
        industry,
        location,
        limit,
        accountId
      });

      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // Build LinkedIn search URL
      const searchUrl = `${baseUrl}/linkedin/search?account_id=${accountId}`;

      // Use Classic API (more widely available than Recruiter API)
      // Build search body according to Unipile Classic API spec
      const searchBody = {
        api: 'classic',
        category: 'companies',
        limit: Math.min(limit, 100)
      };

      // Add keywords filter if provided
      if (keywords) {
        searchBody.keywords = keywords;
      }

      // Add industry filter if provided (array of industry IDs or names)
      if (industry) {
        const industryArray = Array.isArray(industry) ? industry : [industry];
        searchBody.industry = industryArray.map(ind => {
          if (/^\d+$/.test(String(ind))) {
            return String(ind); // Already an ID
          } else {
            // Try to find industry ID from name mapping
            const industryMap = {
              'technology': '96',
              'tech': '96',
              'information technology': '96',
              'it': '96',
              'finance': '37',
              'financial services': '37',
              'banking': '37',
              'healthcare': '50',
              'health care': '50',
              'medical': '50',
              'pharmaceutical': '86',
              'manufacturing': '71',
              'retail': '88',
              'e-commerce': '55',
              'education': '84',
              'media': '80',
              'entertainment': '71',
              'telecommunications': '104',
              'telecom': '104',
              'automotive': '20',
              'real estate': '87',
              'transportation': '102',
              'logistics': '102',
              'energy': '94',
              'utilities': '106',
              'construction': '48',
              'agriculture': '1',
              'chemicals': '41',
              'consulting': '47',
              'legal': '76',
              'accounting': '12',
              'human resources': '57',
              'hr': '57',
              'hospitality': '56',
              'travel': '109',
              'tourism': '109',
              'food & beverage': '62',
              'restaurant': '62',
              'staffing': '98',
              'recruitment': '98'
            };
            return industryMap[String(ind).toLowerCase()] || String(ind);
          }
        });
      }

      // Add location filter if provided (array of location IDs or names)
      if (location) {
        const locationArray = Array.isArray(location) ? location : [location];
        searchBody.location = locationArray.map(loc => {
          if (/^\d+$/.test(String(loc))) {
            return String(loc); // Already an ID
          } else {
            // Try to find location ID from cache
            const locationMap = {
              'dubai': '102927786',
              'uae': '102927786',
              'new york': '103644182',
              'nyc': '103644182',
              'london': '102841502',
              'uk': '102841502',
              'india': '102713980',
              'bangalore': '102713980'
            };
            return locationMap[String(loc).toLowerCase()] || String(loc);
          }
        });
      }

      logger.debug('[Unipile Company Search] Making request to', { 
        url: searchUrl, 
        body: searchBody 
      });

      const response = await axios.post(searchUrl, searchBody, {
        headers,
        timeout: 60000
      });

      // Handle Unipile response structure: items array, with paging and cursor
      const companies = response.data?.items || response.data?.data || response.data?.results || response.data?.companies || [];
      const paging = response.data?.paging || {};

      logger.info('[Unipile Company Search] Found companies', {
        count: companies.length,
        total: paging.total_count || companies.length,
        keywords,
        industry,
        location
      });

      return {
        success: true,
        companies: companies,
        count: companies.length,
        total: paging.total_count,
        paging: paging,
        cursor: response.data?.cursor,
        source: 'unipile'
      };
    } catch (error) {
      logger.error('[Unipile Company Search] Search failed', {
        error: error.message,
        params,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        companies: [],
        count: 0
      };
    }
  }

  /**
   * Search people (leads) on LinkedIn via Unipile
   * 
   * @param {Object} params - Search parameters
   * @param {string} params.keywords - Search keywords (e.g., "software engineer")
   * @param {string|Array} params.industry - Industry ID(s) (e.g., "4" for Technology)
   * @param {string|Array} params.location - Location ID(s) for current location
   * @param {string} params.designation - Current job title keywords
   * @param {string} params.company - Company name or ID
   * @param {string} params.skills - Skill keywords or IDs
   * @param {number} params.limit - Max results (default: 50)
   * @param {string} params.accountId - Unipile LinkedIn account ID (required)
   * @returns {Promise<Object>} Search results with people array
   */
  async searchPeople(params) {
    try {
      const { keywords, industry, location, designation, company, skills, limit = 50, accountId } = params;

      if (!accountId) {
        throw new Error('accountId is required to search people');
      }

      if (!keywords && !industry && !location && !designation && !company && !skills) {
        throw new Error('At least one search filter is required');
      }

      logger.info('[Unipile People Search] Searching leads', {
        keywords,
        industry,
        location,
        designation,
        company,
        skills,
        limit,
        accountId
      });

      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // LinkedIn people search endpoint
      const searchUrl = `${baseUrl}/linkedin/search?account_id=${accountId}`;

      // Use Classic API (more widely available than Recruiter API)
      // Build search body according to Unipile Classic API spec
      const searchBody = {
        api: 'classic',
        category: 'people',
        limit: Math.min(limit, 100)
      };

      // Add keywords filter if provided
      if (keywords) {
        searchBody.keywords = keywords;
      }

      // Add industry filter if provided (array of industry IDs or names)
      if (industry) {
        const industryArray = Array.isArray(industry) ? industry : [industry];
        searchBody.industry = industryArray.map(ind => {
          if (/^\d+$/.test(String(ind))) {
            return String(ind); // Already an ID
          } else {
            // Try to find industry ID from name mapping
            const industryMap = {
              'technology': '96',
              'tech': '96',
              'information technology': '96',
              'it': '96',
              'finance': '37',
              'financial services': '37',
              'banking': '37',
              'healthcare': '50',
              'health care': '50',
              'medical': '50',
              'pharmaceutical': '86',
              'manufacturing': '71',
              'retail': '88',
              'e-commerce': '55',
              'education': '84',
              'media': '80',
              'entertainment': '71',
              'telecommunications': '104',
              'telecom': '104',
              'automotive': '20',
              'real estate': '87',
              'transportation': '102',
              'logistics': '102',
              'energy': '94',
              'utilities': '106',
              'construction': '48',
              'agriculture': '1',
              'chemicals': '41',
              'consulting': '47',
              'legal': '76',
              'accounting': '12',
              'human resources': '57',
              'hr': '57',
              'hospitality': '56',
              'travel': '109',
              'tourism': '109',
              'food & beverage': '62',
              'restaurant': '62',
              'staffing': '98',
              'recruitment': '98'
            };
            return industryMap[String(ind).toLowerCase()] || String(ind);
          }
        });
      }

      // Add location filter if provided (array of location IDs or names)
      // Location lookup: Dubai=102927786, NYC=103644182, etc.
      if (location) {
        const locationArray = Array.isArray(location) ? location : [location];
        // If location is a string name, try to lookup the ID, otherwise use as-is
        searchBody.location = locationArray.map(loc => {
          if (/^\d+$/.test(String(loc))) {
            return String(loc); // Already an ID
          } else {
            // Try to find location ID from cache
            const locationMap = {
              'dubai': '102927786',
              'uae': '102927786',
              'new york': '103644182',
              'nyc': '103644182',
              'london': '102841502',
              'uk': '102841502',
              'india': '102713980',
              'bangalore': '102713980'
            };
            return locationMap[String(loc).toLowerCase()] || String(loc);
          }
        });
      }

      // Add advanced keywords for designation (job title)
      if (designation) {
        searchBody.advanced_keywords = searchBody.advanced_keywords || {};
        searchBody.advanced_keywords.title = designation;
      }

      // Add company filter if provided (array of company names or IDs)
      if (company) {
        searchBody.company = Array.isArray(company) ? company : [company];
      }

      logger.debug('[Unipile People Search] Making request to', { 
        url: searchUrl, 
        body: searchBody 
      });

      const response = await axios.post(searchUrl, searchBody, {
        headers,
        timeout: 60000
      });

      // Handle Unipile response structure: items array, with paging and cursor
      const people = response.data?.items || response.data?.data || response.data?.results || response.data?.people || [];
      const paging = response.data?.paging || {};

      logger.info('[Unipile People Search] Found leads', {
        count: people.length,
        total: paging.total_count || people.length,
        keywords,
        industry,
        location,
        designation,
        company
      });

      // Format results
      const formattedPeople = this.formatPeople(people);

      return {
        success: true,
        people: formattedPeople,
        count: formattedPeople.length,
        total: paging.total_count,
        paging: paging,
        cursor: response.data?.cursor,
        source: 'unipile'
      };
    } catch (error) {
      logger.error('[Unipile People Search] Search failed', {
        error: error.message,
        params,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        people: [],
        count: 0
      };
    }
  }

  /**
   * Combined search for companies and their employees
   * 
   * @param {Object} params - Search parameters
   * @returns {Promise<Object>} Results with companies and leads
   */
  async searchCompaniesAndLeads(params) {
    try {
      const { industry, location, designation, accountId, limit = 50 } = params;

      if (!accountId) {
        throw new Error('accountId is required');
      }

      logger.info('[Unipile Combined Search] Starting combined search', {
        industry,
        location,
        designation,
        accountId
      });

      // Search companies first
      const companiesResult = await this.searchCompanies({
        industry,
        location,
        accountId,
        limit: 20 // Get top companies
      });

      // Then search people with all filters
      const peopleResult = await this.searchPeople({
        industry,
        location,
        designation,
        accountId,
        limit
      });

      return {
        success: companiesResult.success && peopleResult.success,
        companies: companiesResult.companies || [],
        people: peopleResult.people || [],
        totalCompanies: companiesResult.count || 0,
        totalPeople: peopleResult.count || 0,
        source: 'unipile'
      };
    } catch (error) {
      logger.error('[Unipile Combined Search] Search failed', {
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        companies: [],
        people: [],
        totalCompanies: 0,
        totalPeople: 0
      };
    }
  }

  /**
   * Format people data from Unipile response
   * Handles both response formats: direct people objects and sales_navigator format
   */
  formatPeople(people) {
    return people.map(person => {
      // Extract current position info if available
      const currentPosition = person.current_positions?.[0] || {};
      const currentCompany = currentPosition.company || person.company_name || null;
      const currentTitle = currentPosition.role || person.title || person.job_title || null;
      const tenure = currentPosition.tenure_at_role?.years || null;

      return {
        id: person.id || person.profile_id,
        name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
        first_name: person.first_name,
        last_name: person.last_name,
        title: currentTitle,
        current_company: currentCompany,
        tenure_years: tenure,
        email: person.email || null, // LinkedIn doesn't expose emails via Unipile
        linkedin_url: person.profile_url || person.linkedin_url || person.public_profile_url,
        public_identifier: person.public_identifier,
        company_name: currentCompany,
        industry: person.industry,
        location: person.location,
        headline: person.headline,
        photo_url: person.photo_url || person.profile_picture_url,
        network_distance: person.network_distance,
        premium: person.premium || false,
        open_profile: person.open_profile,
        // Original data for reference
        _unipile_data: person
      };
    });
  }

  /**
   * Retrieve detailed profile information for a LinkedIn profile
   * 
   * @param {string} profileUrl - LinkedIn profile URL
   * @param {string} accountId - Unipile account ID
   * @returns {Promise<Object>} Detailed profile information
   */
  async getProfileDetails(profileUrl, accountId) {
    try {
      if (!accountId) {
        throw new Error('accountId is required');
      }

      if (!profileUrl) {
        throw new Error('profileUrl is required');
      }

      logger.info('[Unipile Profile Details] Fetching profile', { profileUrl, accountId });

      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // Extract LinkedIn ID or handle from URL
      const linkedinId = this.extractLinkedInIdentifier(profileUrl);

      // Correct Unipile API endpoint: /api/v1/users/{identifier}
      const response = await axios.get(`${baseUrl}/users/${linkedinId}`, {
        headers,
        params: { account_id: accountId },
        timeout: 30000
      });

      const profile = response.data?.data || response.data;

      logger.info('[Unipile Profile Details] Successfully fetched profile', { linkedinId });

      return {
        success: true,
        profile: profile,
        source: 'unipile'
      };
    } catch (error) {
      logger.error('[Unipile Profile Details] Fetch failed', {
        error: error.message,
        profileUrl,
        status: error.response?.status,
        statusText: error.response?.statusText,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        profile: null
      };
    }
  }

  /**
   * Extract LinkedIn identifier from profile URL
   */
  extractLinkedInIdentifier(profileUrl) {
    // Handle URLs like:
    // - https://www.linkedin.com/in/john-doe
    // - linkedin.com/in/john-doe
    // - /in/john-doe
    // - john-doe

    const match = profileUrl.match(/\/in\/([a-z0-9-]+)/i);
    if (match) {
      return match[1];
    }

    // If no /in/ pattern, assume it's already a handle
    return profileUrl.replace(/\/$/, '').split('/').pop();
  }

  /**
   * Cache search results to employees_cache table
   */
  async cacheResults(tenantId, results, searchParams) {
    try {
      if (!Array.isArray(results) || results.length === 0) {
        return { cached: 0 };
      }

      const schema = getSchema(null);

      const values = results.map(person => [
        person.id || person.profile_id,
        person.name,
        person.title,
        person.email || null,
        person.linkedin_url,
        person.photo_url || null,
        person.headline || null,
        person.location,
        person.company_name,
        null, // company_id
        null, // company_domain
        null, // company_website
        JSON.stringify(person._unipile_data || person),
        tenantId,
        new Date()
      ]);

      // Batch insert with ON CONFLICT UPDATE
      const placeholders = values
        .map(
          (_, i) =>
            `($${i * 15 + 1}, $${i * 15 + 2}, $${i * 15 + 3}, $${i * 15 + 4}, $${i * 15 + 5}, $${i * 15 + 6}, $${i * 15 + 7}, $${i * 15 + 8}, $${i * 15 + 9}, $${i * 15 + 10}, $${i * 15 + 11}, $${i * 15 + 12}, $${i * 15 + 13}, $${i * 15 + 14}, $${i * 15 + 15})`
        )
        .join(',');

      const flatValues = values.flat();

      const query = `
        INSERT INTO ${schema}.employees_cache 
        (id, name, title, email, linkedin_url, photo_url, headline, city, company_name, company_id, company_domain, company_website_url, employee_data, tenant_id, cached_at)
        VALUES ${placeholders}
        ON CONFLICT(id) DO UPDATE SET
          name = EXCLUDED.name,
          title = EXCLUDED.title,
          linkedin_url = EXCLUDED.linkedin_url,
          employee_data = EXCLUDED.employee_data,
          cached_at = EXCLUDED.cached_at
      `;

      await pool.query(query, flatValues);

      logger.info('[Unipile Cache] Cached results', { count: results.length, tenantId });

      return { cached: results.length };
    } catch (error) {
      logger.warn('[Unipile Cache] Failed to cache results', {
        error: error.message,
        count: results.length
      });

      return { cached: 0, error: error.message };
    }
  }

  /**
   * Look up location ID by location name
   * Unipile requires location IDs, not names
   * 
   * @param {string} locationName - Location name (e.g., "Dubai")
   * @param {string} accountId - Account ID for the search
   * @returns {Promise<string|null>} Location ID or null if not found
   */
  async lookupLocationId(locationName, accountId) {
    try {
      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // Common location ID mappings (hardcoded for quick lookup)
      const commonLocations = {
        'dubai': '103644883',
        'uae': '103644883',
        'new york': '103644182',
        'us': '103664155',
        'united states': '103664155',
        'london': '103644409',
        'uk': '103644409',
        'india': '103644393',
        'bangalore': '103644393',
        'san francisco': '103644181',
        'california': '103644181',
        'los angeles': '103644684',
        'texas': '103644685',
        'toronto': '103644724',
        'canada': '103644724',
        'sydney': '103644797',
        'australia': '103644797'
      };

      const normalized = locationName.toLowerCase().trim();
      if (commonLocations[normalized]) {
        logger.debug('[Unipile Location Lookup] Found in cache', { locationName, id: commonLocations[normalized] });
        return commonLocations[normalized];
      }

      // Fallback: make API call to search parameters endpoint
      logger.debug('[Unipile Location Lookup] Calling API for location', { locationName });

      const searchUrl = `${baseUrl}/linkedin/search/parameters?type=LOCATION&keyword=${encodeURIComponent(locationName)}`;
      const response = await axios.get(searchUrl, {
        headers,
        timeout: 30000
      });

      const results = response.data?.data || response.data?.results || [];
      if (results.length > 0) {
        const locationId = results[0].id || results[0].ID;
        logger.info('[Unipile Location Lookup] Found location', { locationName, id: locationId });
        return String(locationId);
      }

      logger.warn('[Unipile Location Lookup] Location not found', { locationName });
      return null;
    } catch (error) {
      logger.error('[Unipile Location Lookup] Failed to lookup location', {
        locationName,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Look up skill ID by skill name
   * Unipile supports both skill IDs and keywords
   * 
   * @param {string} skillName - Skill name (e.g., "Python")
   * @param {string} accountId - Account ID for the search
   * @returns {Promise<string|null>} Skill ID or null if not found
   */
  async lookupSkillId(skillName, accountId) {
    try {
      // Common skill ID mappings
      const commonSkills = {
        'python': '185',
        'javascript': '2',
        'java': '3',
        'c++': '4',
        'c#': '5',
        'react': '6',
        'node.js': '7',
        'sql': '8',
        'html': '9',
        'css': '10',
        'aws': '233',
        'kubernetes': '234',
        'docker': '235',
        'git': '236',
        'linux': '237'
      };

      const normalized = skillName.toLowerCase().trim();
      if (commonSkills[normalized]) {
        logger.debug('[Unipile Skill Lookup] Found in cache', { skillName, id: commonSkills[normalized] });
        return commonSkills[normalized];
      }

      // If not in cache and not numeric, return as keyword
      if (!/^\d+$/.test(skillName)) {
        logger.debug('[Unipile Skill Lookup] Returning as keyword', { skillName });
        return skillName;
      }

      return skillName;
    } catch (error) {
      logger.error('[Unipile Skill Lookup] Failed to lookup skill', {
        skillName,
        error: error.message
      });
      return skillName; // Fallback to keyword
    }
  }

  /**
   * Fetch recent posts/activity from a LinkedIn profile
   * Used for profile summary generation to analyze professional activity
   * 
   * Unipile API endpoint: /api/v1/users/{identifier}/posts
   * 
   * @param {string} linkedinIdOrUrl - LinkedIn profile ID/handle or URL
   * @param {string} accountId - Account ID for the Unipile request
   * @param {number} limit - Maximum number of posts to fetch (default: 10)
   * @returns {Promise<Object>} Posts data or empty array if fetch fails
   */
  async getLinkedInPosts(linkedinIdOrUrl, accountId, limit = 10) {
    try {
      if (!accountId) {
        throw new Error('accountId is required');
      }

      if (!linkedinIdOrUrl) {
        throw new Error('linkedinId is required');
      }

      // Extract LinkedIn identifier from URL if needed
      const linkedinId = this.extractLinkedInIdentifier(linkedinIdOrUrl);

      logger.info('[Unipile Posts] Fetching posts', { linkedinId, accountId, limit });

      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // Correct Unipile API endpoint: /api/v1/users/{identifier}/posts
      const response = await axios.get(`${baseUrl}/users/${linkedinId}/posts`, {
        headers,
        params: { 
          account_id: accountId,
          limit: limit
        },
        timeout: 30000
      });

      const posts = response.data?.data || response.data?.posts || response.data;
      
      if (Array.isArray(posts) && posts.length > 0) {
        const limitedPosts = posts.slice(0, limit);
        logger.info('[Unipile Posts] Successfully fetched posts', { 
          linkedinId, 
          count: limitedPosts.length
        });
        
        return {
          success: true,
          posts: limitedPosts,
          count: limitedPosts.length,
          source: 'unipile'
        };
      }

      logger.warn('[Unipile Posts] No posts found', { linkedinId });
      return {
        success: false,
        posts: [],
        count: 0,
        source: 'unipile'
      };
    } catch (error) {
      logger.error('[Unipile Posts] Failed to fetch posts', {
        error: error.message,
        linkedinId: linkedinIdOrUrl,
        status: error.response?.status,
        statusText: error.response?.statusText,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        posts: [],
        count: 0
      };
    }
  }
}

module.exports = new UnipileLeadSearchService();
