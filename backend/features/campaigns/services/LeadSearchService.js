/**
 * Lead Search Service
 * Handles searching for leads from database and Apollo API
 */
const axios = require('axios');
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
// Don't call getBackendUrl() at module load time - call it when needed
// const BACKEND_URL = getBackendUrl();
/**
 * Get authentication headers for API calls
 * For user requests: Use authToken
 * For service-to-service calls: Use x-tenant-id header (no auth required)
 */
function getAuthHeaders(authToken, tenantId = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (authToken) {
    // User-authenticated request
    headers['Authorization'] = `Bearer ${authToken}`;
    // Also include tenant header as fallback if JWT doesn't have tenantId in payload
    if (tenantId) {
      headers['x-tenant-id'] = tenantId;
    }
  } else if (tenantId) {
    // Service-to-service call - use tenant header instead of auth
    // The Apollo leads controller supports x-tenant-id for internal calls
    headers['x-tenant-id'] = tenantId;
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
 * @param {string} authToken - Optional JWT token for user authentication
 * @param {string} tenantId - Tenant ID for service-to-service calls (when no authToken)
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken = null, tenantId = null) {
  try {
    const dbResponse = await axios.post(
      `${getBackendUrl()}/api/apollo-leads/search-employees-from-db`,
      {
        ...searchParams,
        page: page,
        per_page: 100
      },
      {
        headers: getAuthHeaders(authToken, tenantId),
        timeout: 60000
      }
    );
    if (dbResponse.data && dbResponse.data.success !== false) {
      let dbEmployees = dbResponse.data.employees || dbResponse.data || [];
      // Filter out excluded IDs (leads already used by this tenant)
      if (searchParams.exclude_ids && searchParams.exclude_ids.length > 0) {
        const excludeSet = new Set(searchParams.exclude_ids);
        const beforeFilter = dbEmployees.length;
        dbEmployees = dbEmployees.filter(emp => {
          const empId = emp.id || emp.apollo_person_id;
          return empId && !excludeSet.has(empId);
        });
          before: beforeFilter, 
          after: dbEmployees.length, 
          filtered: beforeFilter - dbEmployees.length 
        });
      }
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
      // Return empty array with special flag to indicate access denied (not an error)
      return { 
        employees: [], 
        fromSource: 'database', 
        accessDenied: true,
        error: 'Apollo Leads feature access required'
      };
    }
    if (dbError.code === 'ECONNREFUSED' || dbError.code === 'ENOTFOUND') {
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
async function searchEmployeesFromApollo(searchParams, page, offsetInPage, neededCount, authToken = null, tenantId = null) {
  try {
    const apolloParams = {
      ...searchParams,
      page: page,
      per_page: 100
    };
    // Try calling Apollo API directly - if endpoint doesn't exist, fallback to database endpoint
    let apolloResponse;
    try {
      apolloResponse = await axios.post(
        `${getBackendUrl()}/api/apollo-leads/search-employees`,
        apolloParams,
        {
          headers: getAuthHeaders(authToken, tenantId),
          timeout: 60000
        }
      );
    } catch (apolloEndpointError) {
      // If Apollo endpoint doesn't exist, use database endpoint which may fetch from Apollo
      try {
        apolloResponse = await axios.post(
          `${getBackendUrl()}/api/apollo-leads/search-employees-from-db`,
          apolloParams,
          {
            headers: getAuthHeaders(authToken, tenantId),
            timeout: 60000
          }
        );
      } catch (dbEndpointError) {
        throw dbEndpointError; // Re-throw to be caught by outer catch
      }
    }
    if (apolloResponse.data && apolloResponse.data.success !== false) {
      let apolloEmployees = apolloResponse.data.employees || apolloResponse.data || [];
      // Filter out excluded IDs (leads already used by this tenant)
      if (searchParams.exclude_ids && searchParams.exclude_ids.length > 0) {
        const excludeSet = new Set(searchParams.exclude_ids);
        const beforeFilter = apolloEmployees.length;
        apolloEmployees = apolloEmployees.filter(emp => {
          const empId = emp.id || emp.apollo_person_id;
          return empId && !excludeSet.has(empId);
        });
          before: beforeFilter, 
          after: apolloEmployees.length, 
          filtered: beforeFilter - apolloEmployees.length 
        });
      }
      // Apply offset within Apollo page and take what we need
      return apolloEmployees.slice(offsetInPage, offsetInPage + neededCount);
    }
    return [];
  } catch (apolloError) {
    // Handle 403 Forbidden (user doesn't have Apollo feature access)
    if (apolloError.response && apolloError.response.status === 403) {
      // Return empty array - access denied is not an error, just no leads available
      return [];
    }
    if (apolloError.code === 'ECONNREFUSED' || apolloError.code === 'ENOTFOUND') {
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
  // STEP 1: Try to get leads from database first
  const dbResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken, tenantId);
  let employees = dbResult.employees;
  let fromSource = dbResult.fromSource;
  const accessDenied = dbResult.accessDenied || false;
  if (accessDenied) {
    // Return early with access denied flag
    return { employees: [], fromSource: 'database', accessDenied: true };
  }
  // STEP 2: If not enough leads from database, fetch from Apollo
  if (employees.length < dailyLimit) {
    const neededFromApollo = dailyLimit - employees.length;
    const apolloEmployees = await searchEmployeesFromApollo(searchParams, page, offsetInPage, neededFromApollo, authToken, tenantId);
    // Combine database leads with Apollo leads
    employees = [...employees, ...apolloEmployees].slice(0, dailyLimit);
    fromSource = employees.length > (dailyLimit - neededFromApollo) ? 'mixed' : 'apollo';
  } else {
  }
  return { employees, fromSource };
}
module.exports = {
  searchEmployeesFromDatabase,
  searchEmployeesFromApollo,
  searchEmployees
};