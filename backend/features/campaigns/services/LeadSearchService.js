/**
 * Lead Search Service
 * Handles searching for leads from database and Apollo API
 */

const axios = require('axios');
const logger = require('../../../core/utils/logger');

// Use the actual backend URL - prioritize internal URL, then public URL
// No hardcoded fallback - must be set via environment variables
function getBackendUrl() {
  // If explicitly set, use it
  if (process.env.BACKEND_INTERNAL_URL) return process.env.BACKEND_INTERNAL_URL;
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL;
  if (process.env.NEXT_PUBLIC_BACKEND_URL) return process.env.NEXT_PUBLIC_BACKEND_URL;
  
  // No hardcoded fallback - must be set via environment variables
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be set');
}

const BACKEND_URL = getBackendUrl();

/**
 * Get authentication headers for API calls
 * If authToken is provided, use it. Otherwise try to get from environment.
 */
function getAuthHeaders(authToken) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  } else if (process.env.JWT_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.JWT_TOKEN}`;
  }
  
  return headers;
}

/**
 * Search employees from database
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} dailyLimit - Daily limit of leads needed
 * @param {string} authToken - Optional JWT token for authentication
 * @param {string} tenantId - Tenant ID for multi-tenant context
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken = null, tenantId = null) {
  logger.debug('[Lead Search] Searching database for leads', { searchParams, page, offsetInPage, dailyLimit });
  try {
    logger.debug('[Lead Search] Checking database (employees_cache)', { page });
    
    // For internal service-to-service calls, use the service directly instead of HTTP
    if (!authToken && process.env.NODE_ENV === 'production') {
      // Use provided tenantId or fall back to default
      const effectiveTenantId = tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
      
      logger.info('[Lead Search] Using direct service call for internal request', { 
        effectiveTenantId, 
        providedTenantId: tenantId,
        env: process.env.NODE_ENV,
        usingProvidedTenant: !!tenantId
      });
      
      const ApolloLeadsService = require('../../apollo-leads/services/ApolloLeadsService');
      
      // Create a mock request object with proper tenant context matching ApolloLeadsController expectations
      const mockReq = {
        body: {
          ...searchParams,
          page: page,
          per_page: 100
        },
        user: { 
          tenant_id: effectiveTenantId  // This matches the controller's req.user?.tenant_id check
        },
        headers: {
          'x-tenant-id': effectiveTenantId  // Backup header for tenant context
        }
      };
      
      try {
        logger.debug('[Lead Search] Calling ApolloLeadsService.searchEmployeesFromDb directly', { 
          tenantId: effectiveTenantId, 
          hasUser: !!mockReq.user,
          hasTenantId: !!mockReq.user?.tenant_id 
        });
        
        const result = await ApolloLeadsService.searchEmployeesFromDb(mockReq.body, mockReq);
        
        logger.debug('[Lead Search] Direct service call result', { 
          hasResult: !!result, 
          success: result?.success,
          employeeCount: result?.employees?.length || 0 
        });
        
        if (result && result.success !== false) {
          const dbEmployees = result.employees || result || [];
          logger.info('[Lead Search] Found leads in database (direct call)', { count: dbEmployees.length, page });
          
          // Apply offset within this page and take daily limit
          const availableFromDb = dbEmployees.slice(offsetInPage, offsetInPage + dailyLimit);
          
          if (availableFromDb.length >= dailyLimit) {
            // We have enough from database
            return {
              employees: availableFromDb.slice(0, dailyLimit),
              fromSource: 'database'
            };
          } else {
            // Not enough in database, take what we have
            return {
              employees: availableFromDb,
              fromSource: 'mixed'
            };
          }
        }
        
        logger.warn('[Lead Search] Direct service call returned no results or failed', { result });
        return { employees: [], fromSource: 'database' };
      } catch (serviceError) {
        logger.error('[Lead Search] Direct service call failed, falling back to HTTP', { 
          error: serviceError.message, 
          stack: serviceError.stack,
          tenantId: effectiveTenantId 
        });
        // Fall through to HTTP call with better error handling
      }
    }
    
    // HTTP fallback call with tenant context header
    const effectiveTenantId = tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    const headers = {
      ...getAuthHeaders(authToken),
      'x-tenant-id': effectiveTenantId  // Add tenant context for internal calls
    };
    
    logger.debug('[Lead Search] Making HTTP call to search-employees-from-db', {
      url: `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
      hasAuthToken: !!authToken,
      tenantId: effectiveTenantId,
      providedTenantId: tenantId,
      usingProvidedTenant: !!tenantId
    });
    
    const dbResponse = await axios.post(
      `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
      {
        ...searchParams,
        page: page,
        per_page: 100
      },
      {
        headers: headers,
        timeout: 60000
      }
    );
    
    if (dbResponse.data && dbResponse.data.success !== false) {
      const dbEmployees = dbResponse.data.employees || dbResponse.data || [];
      logger.info('[Lead Search] Found leads in database', { count: dbEmployees.length, page });
      
      // Apply offset within this page and take daily limit
      const availableFromDb = dbEmployees.slice(offsetInPage, offsetInPage + dailyLimit);
      
      if (availableFromDb.length >= dailyLimit) {
        // We have enough from database
        return {
          employees: availableFromDb.slice(0, dailyLimit),
          fromSource: 'database'
        };
      } else {
        // Not enough in database, take what we have
        return {
          employees: availableFromDb,
          fromSource: 'mixed'
        };
      }
    }
    
    return { employees: [], fromSource: 'database' };
  } catch (dbError) {
    // Handle 403 Forbidden (user doesn't have Apollo feature access)
    if (dbError.response && dbError.response.status === 403) {
      logger.warn('[Lead Search] User does not have Apollo Leads feature access - database access denied');
      logger.warn('[Lead Search] Campaign will continue without lead generation');
      // Return empty array with special flag to indicate access denied (not an error)
      return { 
        employees: [], 
        fromSource: 'database', 
        accessDenied: true,
        error: 'Apollo Leads feature access required'
      };
    }
    
    logger.error('[Lead Search] Error fetching from database', { error: dbError.message, status: dbError.response?.status, responseData: dbError.response?.data, code: dbError.code });
    if (dbError.code === 'ECONNREFUSED' || dbError.code === 'ENOTFOUND') {
      logger.error('[Lead Search] Cannot reach backend server', { backendUrl: BACKEND_URL, message: 'This will cause lead generation to fail silently!' });
    }
    // Return empty array but log the error so it's visible
    return { employees: [], fromSource: 'database', error: dbError.message };
  }
}

/**
 * Search employees from Apollo API
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} neededCount - Number of leads needed
 * @param {string} authToken - Optional JWT token for authentication
 * @returns {Array} Array of employees
 */
async function searchEmployeesFromApollo(searchParams, page, offsetInPage, neededCount, authToken = null) {
  try {
    logger.debug('[Lead Search] Fetching from Apollo API', { page });
    
    const apolloParams = {
      ...searchParams,
      page: page,
      per_page: 100
    };
    
    // Try calling Apollo API directly - if endpoint doesn't exist, fallback to database endpoint
    logger.debug('[Lead Search] Calling Apollo API', { url: `${BACKEND_URL}/api/apollo-leads/search-employees`, searchParams: apolloParams });
    
    let apolloResponse;
    try {
      apolloResponse = await axios.post(
        `${BACKEND_URL}/api/apollo-leads/search-employees`,
        apolloParams,
        {
          headers: getAuthHeaders(authToken),
          timeout: 60000
        }
      );
      logger.info('[Lead Search] Apollo API responded', { status: apolloResponse.status });
    } catch (apolloEndpointError) {
      // If Apollo endpoint doesn't exist, use database endpoint which may fetch from Apollo
      logger.warn('[Lead Search] Apollo endpoint failed, trying database endpoint', { error: apolloEndpointError.message, status: apolloEndpointError.response?.status, responseData: apolloEndpointError.response?.data });
      try {
        apolloResponse = await axios.post(
          `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
          apolloParams,
          {
            headers: getAuthHeaders(authToken),
            timeout: 60000
          }
        );
        logger.info('[Lead Search] Database endpoint responded', { status: apolloResponse.status });
      } catch (dbEndpointError) {
        logger.error('[Lead Search] Database endpoint also failed', { error: dbEndpointError.message, status: dbEndpointError.response?.status, responseData: dbEndpointError.response?.data });
        throw dbEndpointError; // Re-throw to be caught by outer catch
      }
    }
    
    if (apolloResponse.data && apolloResponse.data.success !== false) {
      const apolloEmployees = apolloResponse.data.employees || apolloResponse.data || [];
      logger.info('[Lead Search] Found leads from Apollo', { count: apolloEmployees.length, page });
      
      // Apply offset within Apollo page and take what we need
      return apolloEmployees.slice(offsetInPage, offsetInPage + neededCount);
    }
    
    return [];
  } catch (apolloError) {
    // Handle 403 Forbidden (user doesn't have Apollo feature access)
    if (apolloError.response && apolloError.response.status === 403) {
      logger.warn('[Lead Search] User does not have Apollo Leads feature access - Apollo API access denied');
      logger.warn('[Lead Search] Campaign will continue without Apollo lead generation');
      // Return empty array - access denied is not an error, just no leads available
      return [];
    }
    
    logger.error('[Lead Search] Error fetching from Apollo', { error: apolloError.message, status: apolloError.response?.status, responseData: apolloError.response?.data, code: apolloError.code, url: `${BACKEND_URL}/api/apollo-leads/search-employees` });
    if (apolloError.code === 'ECONNREFUSED' || apolloError.code === 'ENOTFOUND') {
      logger.error('[Lead Search] Cannot reach backend server', { backendUrl: BACKEND_URL, message: 'This will cause lead generation to fail silently!' });
    }
    // Return empty array but log the error so it's visible
    return [];
  }
}

/**
 * Search for employees combining database and Apollo sources
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} dailyLimit - Daily limit of leads needed
 * @param {string} authToken - Optional JWT token for authentication
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployees(searchParams, page, offsetInPage, dailyLimit, authToken = null, tenantId = null) {
  logger.info('[Lead Search] Starting employee search', { searchParams, page, offsetInPage, dailyLimit, backendUrl: BACKEND_URL });
  
  // STEP 1: Try to get leads from database first
  logger.debug('[Lead Search] STEP 1: Searching database');
  const dbResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken);
  let employees = dbResult.employees;
  let fromSource = dbResult.fromSource;
  const accessDenied = dbResult.accessDenied || false;
  
  logger.info('[Lead Search] Database search result', { leadCount: employees.length, source: fromSource, error: dbResult.error || null });
  if (accessDenied) {
    logger.warn('[Lead Search] Access denied - user does not have Apollo Leads feature access');
    // Return early with access denied flag
    return { employees: [], fromSource: 'database', accessDenied: true };
  }
  
  // STEP 2: If not enough leads from database, fetch from Apollo
  if (employees.length < dailyLimit) {
    const neededFromApollo = dailyLimit - employees.length;
    logger.debug('[Lead Search] STEP 2: Need more leads, fetching from Apollo', { neededFromApollo });
    const apolloEmployees = await searchEmployeesFromApollo(searchParams, page, offsetInPage, neededFromApollo, authToken);
    
    // Combine database leads with Apollo leads
    employees = [...employees, ...apolloEmployees].slice(0, dailyLimit);
    fromSource = employees.length > (dailyLimit - neededFromApollo) ? 'mixed' : 'apollo';
    
    logger.info('[Lead Search] Combined total', { total: employees.length, fromDb: employees.length - apolloEmployees.length, fromApollo: apolloEmployees.length });
  } else {
    logger.info('[Lead Search] Got enough leads from database, skipping Apollo', { count: employees.length, dailyLimit });
  }
  
  logger.info('[Lead Search] Final result', { leadCount: employees.length, source: fromSource });
  return { employees, fromSource };
}

module.exports = {
  searchEmployeesFromDatabase,
  searchEmployeesFromApollo,
  searchEmployees
};

