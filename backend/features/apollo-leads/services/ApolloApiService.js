/**
 * Apollo API Service
 * Handles Apollo API calls and Python script execution
 * LAD Architecture Compliant
 */

const axios = require('axios');
const path = require('path');
const { spawn, execSync } = require('child_process');
const logger = require('../../../core/utils/logger');
const CompanySearchCacheRepository = require('../repositories/CompanySearchCacheRepository');

/**
 * Helper function to call Python Apollo service
 * Uses LAD_SCRIPTS_PATH environment variable (LAD architecture compliant)
 * Falls back to API endpoint if Python script is not available
 */
function callApolloService(method, params = {}) {
  return new Promise((resolve, reject) => {
    // LAD RULE: Use environment variable, NEVER guess paths
    // Path guessing is FORBIDDEN in LAD architecture
    let scriptPath = null;
    const fs = require('fs');
    
    // Priority 1: LAD_SCRIPTS_PATH (for local development with symlink)
    if (process.env.LAD_SCRIPTS_PATH) {
      const candidatePath = path.join(process.env.LAD_SCRIPTS_PATH, 'apollo_service.py');
      if (fs.existsSync(candidatePath)) {
        scriptPath = candidatePath;
        logger.debug('[Apollo API] Using script from LAD_SCRIPTS_PATH', { path: scriptPath });
      }
    }
    
    // Priority 2: APOLLO_SERVICE_SCRIPT_PATH (direct path override)
    if (!scriptPath && process.env.APOLLO_SERVICE_SCRIPT_PATH) {
      if (fs.existsSync(process.env.APOLLO_SERVICE_SCRIPT_PATH)) {
        scriptPath = process.env.APOLLO_SERVICE_SCRIPT_PATH;
        logger.debug('[Apollo API] Using script from APOLLO_SERVICE_SCRIPT_PATH', { path: scriptPath });
      }
    }
    
    // Priority 3: Standard LAD location (when merged to LAD)
    if (!scriptPath) {
      // Try standard LAD location: backend/shared/services/apollo_service.py
      // This is relative to where the service is running (LAD backend root)
      const standardPath = path.join(process.cwd(), 'backend', 'shared', 'services', 'apollo_service.py');
      if (fs.existsSync(standardPath)) {
        scriptPath = standardPath;
        logger.debug('[Apollo API] Using script from standard LAD location', { path: scriptPath });
      }
    }
    
    // If Python script not found, reject to trigger fallback
    if (!scriptPath) {
      logger.warn('[Apollo API] Python script not found. Set LAD_SCRIPTS_PATH or APOLLO_SERVICE_SCRIPT_PATH env var.');
      reject(new Error('Python script not found - will use API endpoint'));
      return;
    }
    
    // Find Python executable - try python3, python, then py (Windows)
    let pythonExec = null;
    const pythonExecs = ['python3', 'python', 'py'];
    
    for (const exec of pythonExecs) {
      try {
        execSync(`${exec} --version`, { stdio: 'ignore' });
        pythonExec = exec;
        break;
      } catch (e) {
        // Try next executable
      }
    }
    
    // If no Python executable found, reject to trigger fallback
    if (!pythonExec) {
      reject(new Error('Python not found - will use API endpoint'));
      return;
    }
    
    logger.debug('[Apollo API] Using Python executable', { exec: pythonExec, script: scriptPath });
    const pythonProcess = spawn(pythonExec, [scriptPath, method, JSON.stringify(params)]);
    
    let output = '';
    let error = '';
    
    // Handle spawn errors
    pythonProcess.on('error', (spawnError) => {
      reject(new Error(`Python process error: ${spawnError.message}`));
    });
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      const errorText = data.toString();
      error += errorText;
      logger.debug('[Apollo API] Python stderr', { message: errorText.trim() });
    });
    
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // Extract JSON from output
          let jsonString = output.trim();
          
          // Find the first '{' or '[' to identify where JSON starts
          const firstBrace = jsonString.indexOf('{');
          const firstBracket = jsonString.indexOf('[');
          let jsonStart = -1;
          let startChar = '';
          
          if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            jsonStart = firstBrace;
            startChar = '{';
          } else if (firstBracket !== -1) {
            jsonStart = firstBracket;
            startChar = '[';
          }
          
          if (jsonStart > 0) {
            jsonString = jsonString.substring(jsonStart);
          }
          
          // Find matching closing bracket/brace
          let depth = 0;
          let jsonEnd = -1;
          const endChar = startChar === '{' ? '}' : ']';
          
          for (let i = 0; i < jsonString.length; i++) {
            if (jsonString[i] === startChar) {
              depth++;
            } else if (jsonString[i] === endChar) {
              depth--;
              if (depth === 0) {
                jsonEnd = i;
                break;
              }
            }
          }
          
          if (jsonEnd !== -1) {
            jsonString = jsonString.substring(0, jsonEnd + 1);
          }
          
          const result = JSON.parse(jsonString);
          
          // For search_people_direct, return the full result object
          if (result.success !== undefined && result.employees) {
            resolve(result);
          } else if (result.companies) {
            resolve(result.companies);
          } else if (result.leads) {
            resolve(result.leads);
          } else if (result.employees && !result.success) {
            resolve(result.employees);
          } else if (Array.isArray(result)) {
            resolve(result);
          } else {
            resolve(result);
          }
        } catch (e) {
          logger.error('[Apollo API] JSON Parse Error', { error: e.message, output: output.substring(0, 500) });
          reject(new Error('Failed to parse Python output: ' + e.message));
        }
      } else {
        reject(new Error('Python process failed: ' + error));
      }
    });
  });
}

/**
 * Call Apollo.io API directly via HTTP
 * Uses APOLLO_API_KEY and APOLLO_API_BASE_URL from environment variables
 * LAD Architecture: No hardcoded URLs - uses environment configuration
 */
async function callApolloApi(searchParams) {
  const apiKey = process.env.APOLLO_API_KEY || process.env.APOLLO_IO_API_KEY;
  
  if (!apiKey) {
    throw new Error('Apollo API key not configured. Set APOLLO_API_KEY or APOLLO_IO_API_KEY in environment variables.');
  }
  
  // LAD Architecture: Use environment variable or constants (no hardcoded URLs)
  const { APOLLO_CONFIG } = require('../constants/constants');
  // Use base URL from environment or constants
  const apolloBaseUrl = process.env.APOLLO_API_BASE_URL || APOLLO_CONFIG.DEFAULT_BASE_URL;
  
  // LAD Architecture: Use endpoint constant (no hardcoded paths)
  const apolloSearchEndpoint = `${apolloBaseUrl}${APOLLO_CONFIG.ENDPOINTS.MIXED_PEOPLE_SEARCH}`;
  
  const {
    organization_locations = [],
    person_locations = [],  // Personal location (where person lives)
    person_titles = [],
    person_seniorities = [],  // Seniority levels (director, manager, c_suite, etc.)
    organization_industries = [],  // Keep for backward compatibility
    q_organization_domains_list = [],  // Specific company domains for filtering
    per_page = 100,
    page = 1
  } = searchParams;
  
  // Build Apollo.io API request - filters go in QUERY PARAMETERS, not body
  // Apollo expects filters as query params with array syntax: param[]=value1&param[]=value2
  const apolloRequestParams = {
    per_page: per_page || 100,  // Use requested per_page, default 100 (Apollo max)
    page: page || 1,  // Use requested page number, default 1 for pagination
    reveal_personal_emails: true,  // Reveal emails directly in search results
    reveal_phone_number: true  // Reveal phones directly in search results
  };
  
  // Add filters (Apollo expects exact parameter names and array format)
  if (person_titles && person_titles.length > 0) {
    apolloRequestParams.person_titles = person_titles;
  }
  
  // Add seniority filter
  if (person_seniorities && person_seniorities.length > 0) {
    apolloRequestParams.person_seniorities = person_seniorities;
  }
  
  // Support both person_locations (personal) and organization_locations (company)
  if (person_locations && person_locations.length > 0) {
    apolloRequestParams.person_locations = person_locations;
  }
  if (organization_locations && organization_locations.length > 0) {
    apolloRequestParams.organization_locations = organization_locations;
  }
  
  // Company domain filtering (for specific companies) - this is the PREFERRED method for industry filtering
  if (q_organization_domains_list && q_organization_domains_list.length > 0) {
    apolloRequestParams.q_organization_domains_list = q_organization_domains_list;
    logger.info('[Apollo API] Using domain-based filtering (2-step approach)', {
      domainCount: q_organization_domains_list.length
    });
  }
  
  // NOTE: People API Search doesn't have direct industry filter
  // Industry filtering works better with organization search or via q_organization_domains_list
  // Only add organization_industries if we DON'T have domain list (fallback mode)
  if (organization_industries && organization_industries.length > 0 && (!q_organization_domains_list || q_organization_domains_list.length === 0)) {
    apolloRequestParams.organization_industries = organization_industries.map(ind => 
      String(ind).toLowerCase().trim()
    );
    logger.warn('[Apollo API] Note: organization_industries may not be supported by People API Search endpoint. Consider using q_organization_domains_list for company filtering.');
  }
  
  logger.info('[Apollo API] Calling Apollo.io API directly', {
    url: apolloSearchEndpoint,
    baseUrl: apolloBaseUrl,
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'none'
  });
  logger.info('[Apollo API] Request params being sent', {
    ...apolloRequestParams,
    searchCriteria: {
      titles: person_titles?.length || 0,
      locations: organization_locations?.length || 0,
      industries: organization_industries?.length || 0,
      domains: q_organization_domains_list?.length || 0
    }
  });
  
  try {
    // Apollo /mixed_people/api_search expects data in body with X-Api-Key header
    const apolloResponse = await axios.post(
      apolloSearchEndpoint,
      apolloRequestParams,  // Data goes in body for /mixed_people/api_search
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey  // Apollo uses X-Api-Key header (capital X and A)
        },
        timeout: 120000 // 2 minutes for Apollo API
      }
    );
    
    logger.info('[Apollo API] Apollo.io API responded', { status: apolloResponse.status });
    logger.debug('[Apollo API] Response data structure', {
      hasData: !!apolloResponse.data,
      dataKeys: apolloResponse.data ? Object.keys(apolloResponse.data) : [],
      hasPeople: !!(apolloResponse.data && apolloResponse.data.people),
      peopleCount: apolloResponse.data?.people?.length || 0,
      sampleData: apolloResponse.data ? JSON.stringify(apolloResponse.data).substring(0, 500) : 'no data'
    });
    
    if (apolloResponse.data && apolloResponse.data.people) {
      const people = apolloResponse.data.people;
      logger.info('[Apollo API] Found people from Apollo.io', { count: people.length });
      
      return {
        success: true,
        employees: people,
        pagination: apolloResponse.data.pagination || {}
      };
    } else {
      logger.warn('[Apollo API] Apollo.io API returned unexpected format', {
        hasData: !!apolloResponse.data,
        dataKeys: apolloResponse.data ? Object.keys(apolloResponse.data) : [],
        fullResponse: JSON.stringify(apolloResponse.data).substring(0, 1000)
      });
      return {
        success: false,
        employees: [],
        error: 'Unexpected response format from Apollo.io API'
      };
    }
  } catch (apiError) {
    logger.error('[Apollo API] Error calling Apollo.io API directly', {
      message: apiError.message,
      status: apiError.response?.status,
      responseData: apiError.response?.data
    });
    throw apiError;
  }
}

/**
 * Search companies from Apollo API to get domains for industry-based filtering
 * Step 1 of 2-step approach: Get company domains by industry
 * Uses cache to avoid duplicate API calls for same tenant+search combination
 * 
 * @param {Object} searchParams - Search parameters
 * @param {string} tenantId - Tenant ID for caching (optional, but recommended)
 */
async function searchCompaniesForDomains(searchParams, tenantId = null) {
  const apiKey = process.env.APOLLO_API_KEY || process.env.APOLLO_IO_API_KEY;
  
  if (!apiKey) {
    throw new Error('Apollo API key not configured');
  }
  
  const { APOLLO_CONFIG } = require('../constants/constants');
  const apolloBaseUrl = process.env.APOLLO_API_BASE_URL || APOLLO_CONFIG.DEFAULT_BASE_URL;
  const companySearchEndpoint = `${apolloBaseUrl}${APOLLO_CONFIG.ENDPOINTS.ORGANIZATIONS_SEARCH}`;
  
  const {
    organization_industries = [],
    organization_locations = [],
    per_page = 25  // Get 25 companies to find domains
  } = searchParams;
  
  // Create cache key components
  const searchKeywords = organization_industries.join(',').toLowerCase().trim() || 'all';
  const searchLocation = organization_locations.length > 0 
    ? organization_locations.join(',').toLowerCase().trim() 
    : null;
  const searchIndustry = searchKeywords; // For this use case, keywords are the industry
  
  // Check cache first if tenantId is provided
  if (tenantId) {
    try {
      const hasFreshCache = await CompanySearchCacheRepository.hasFreshCache(
        tenantId, 
        searchKeywords, 
        searchLocation, 
        searchIndustry,
        24  // 24 hour TTL
      );
      
      if (hasFreshCache) {
        const cachedDomains = await CompanySearchCacheRepository.getCachedDomains(
          tenantId, 
          searchKeywords, 
          searchLocation, 
          searchIndustry
        );
        
        if (cachedDomains.length > 0) {
          logger.info('[Apollo API] Step 1: Using cached company domains', {
            tenantId: tenantId.substring(0, 8) + '...',
            domainsFromCache: cachedDomains.length,
            sampleDomains: cachedDomains.slice(0, 5)
          });
          
          return {
            success: true,
            domains: cachedDomains,
            companies: cachedDomains.length,
            fromCache: true
          };
        }
      }
    } catch (cacheError) {
      logger.warn('[Apollo API] Cache check failed, proceeding with API call', {
        error: cacheError.message
      });
    }
  }
  
  logger.info('[Apollo API] Step 1: Searching companies by industry', {
    url: companySearchEndpoint,
    industries: organization_industries,
    locations: organization_locations,
    tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none'
  });
  
  try {
    // Apollo Organization Search - API key goes in X-Api-Key header
    const requestBody = {
      page: 1,
      per_page
    };
    
    // Add industry keywords
    if (organization_industries && organization_industries.length > 0) {
      requestBody.q_organization_keyword_tags = organization_industries;
    }
    
    // Add location filter - CRITICAL for finding companies in the right region
    if (organization_locations && organization_locations.length > 0) {
      requestBody.organization_locations = organization_locations;
    }
    
    logger.info('[Apollo API] Step 1 request body', {
      requestBody,
      hasLocations: !!requestBody.organization_locations,
      locationCount: requestBody.organization_locations?.length || 0
    });
    
    const response = await axios.post(
      companySearchEndpoint,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey
        },
        timeout: 120000 // 2 minutes for company search operations
      }
    );
    
    if (response.data && response.data.organizations) {
      const companies = response.data.organizations;
      const domains = companies
        .map(company => company.primary_domain || company.website_url)
        .filter(domain => domain && domain.length > 0)
        .map(domain => {
          // Clean domain - remove http://, https://, www., and trailing paths
          return domain
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .toLowerCase();
        });
      
      const uniqueDomains = [...new Set(domains)];
      
      // Log company locations to verify filtering worked
      const companyLocations = companies.map(c => c.city || c.state || c.country).filter(Boolean);
      const uniqueLocations = [...new Set(companyLocations)];
      
      logger.info('[Apollo API] Step 1 complete: Found company domains', {
        companiesFound: companies.length,
        domainsExtracted: uniqueDomains.length,
        sampleDomains: uniqueDomains.slice(0, 5),
        companyLocations: uniqueLocations.slice(0, 10),
        requestedLocations: organization_locations
      });
      
      // Save to cache if tenantId is provided
      if (tenantId && companies.length > 0) {
        try {
          await CompanySearchCacheRepository.saveCompanies(
            tenantId,
            searchKeywords,
            searchLocation,
            searchIndustry,
            companies,
            1  // Page number
          );
          logger.info('[Apollo API] Saved company search results to cache', {
            tenantId: tenantId.substring(0, 8) + '...',
            companiesSaved: companies.length
          });
        } catch (cacheError) {
          logger.warn('[Apollo API] Failed to save to cache (non-blocking)', {
            error: cacheError.message
          });
        }
      }
      
      return {
        success: true,
        domains: uniqueDomains,
        companies: companies.length,
        fromCache: false
      };
    }
    
    logger.warn('[Apollo API] Step 1: No companies found for industry', {
      industries: organization_industries
    });
    
    return {
      success: false,
      domains: [],
      companies: 0,
      fromCache: false
    };
  } catch (error) {
    logger.error('[Apollo API] Step 1 failed: Company search error', {
      message: error.message,
      status: error.response?.status
    });
    return {
      success: false,
      domains: [],
      companies: 0,
      error: error.message,
      fromCache: false
    };
  }
}

/**
 * Search employees from Apollo API (with 2-step industry support)
 * If industry filter is provided, first search companies to get domains,
 * then search people using those domains.
 * Uses cache to avoid duplicate company lookups for same tenant.
 * 
 * @param {Object} searchParams - Search parameters
 * @param {string} tenantId - Tenant ID for caching (optional, but recommended)
 */
async function searchEmployeesFromApollo(searchParams, tenantId = null) {
  const {
    organization_locations = [],
    person_titles = [],
    organization_industries = [],
    per_page = 100,
    page = 1
  } = searchParams;
  
  const apolloPerPage = 100; // Always request 100 from Apollo
  
  // 2-STEP APPROACH: If industry is specified, first get company domains
  let q_organization_domains_list = [];
  
  if (organization_industries && organization_industries.length > 0) {
    logger.info('[Apollo API] Industry filter detected - using 2-step approach', {
      tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none'
    });
    
    const companyResult = await searchCompaniesForDomains({
      organization_industries,
      organization_locations,
      per_page: 100  // Get up to 100 companies for domain list (increased from 50)
    }, tenantId);  // Pass tenantId for caching
    
    if (companyResult.success && companyResult.domains.length > 0) {
      // Use all available domains (up to 100) to maximize results per API call
      // Apollo can handle large domain lists and will return up to 100 people per page
      q_organization_domains_list = companyResult.domains;
      
      logger.info('[Apollo API] Step 2: Searching people in discovered companies', {
        domainsToSearch: q_organization_domains_list.length,
        page: page || 1,
        fromCache: companyResult.fromCache || false
      });
    } else {
      logger.warn('[Apollo API] No companies found for industry, proceeding with direct search', {
        industries: organization_industries
      });
    }
  }
  
  // Check if people search API should be skipped (API key doesn't have access)
  const { APOLLO_CONFIG } = require('../constants/constants');
  if (APOLLO_CONFIG.SKIP_PEOPLE_SEARCH_API) {
    logger.info('[Apollo API] People search API skipped (APOLLO_SKIP_PEOPLE_SEARCH=true)', {
      reason: 'API key does not have access to people search endpoints',
      companiesFound: q_organization_domains_list.length
    });
    return {
      success: false,
      employees: [],
      error: 'People search API not available - using database cache only',
      skipReason: 'APOLLO_SKIP_PEOPLE_SEARCH'
    };
  }
  
  // Build search params for People API
  const peopleSearchParams = {
    organization_locations,
    // CRITICAL: Also use organization_locations as person_locations
    // This filters by where the PERSON is located, not just the company
    // Without this, a Dubai company search returns employees in any country
    person_locations: organization_locations,
    person_titles,
    per_page: apolloPerPage,
    page: page || 1
  };
  
  // Use domain list if we have it (from 2-step approach)
  if (q_organization_domains_list.length > 0) {
    peopleSearchParams.q_organization_domains_list = q_organization_domains_list;
    // Don't pass organization_industries to People API (it doesn't work)
    logger.info('[Apollo API] Using 2-step approach with location filter', {
      domains: q_organization_domains_list.length,
      personLocations: organization_locations,
      titles: person_titles?.length || 0
    });
  } else {
    // Fallback: pass industry anyway (may not work but won't hurt)
    peopleSearchParams.organization_industries = organization_industries;
  }
  
  try {
    logger.debug('[Apollo API] Attempting to call Apollo via Python script');
    const apolloResult = await callApolloService('search_people_direct', peopleSearchParams);
    logger.info('[Apollo API] Successfully called Apollo via Python script');
    return apolloResult;
  } catch (pythonError) {
    logger.warn('[Apollo API] Python script not available, falling back to API endpoint', {
      error: pythonError.message
    });
    
    // Fallback to HTTP API
    return await callApolloApi(peopleSearchParams);
  }
}

module.exports = {
  callApolloService,
  callApolloApi,
  searchCompaniesForDomains,
  searchEmployeesFromApollo
};