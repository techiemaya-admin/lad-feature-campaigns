/**
 * Lead Search Service
 * Handles searching for leads from database and Apollo API
 */

const axios = require('axios');

// Use the actual backend URL - prioritize internal URL, then public URL, then default
// For remote servers, this should be the same backend URL as the API calls
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL 
  || process.env.NEXT_PUBLIC_BACKEND_URL 
  || process.env.BACKEND_URL 
  || 'https://lad-backend-develop-741719885039.us-central1.run.app';

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
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken = null) {
  console.log(`[Lead Search] 🔍 Searching database for leads...`);
  console.log(`[Lead Search] 📋 Database search params:`, JSON.stringify(searchParams, null, 2));
  console.log(`[Lead Search] 📄 Page: ${page}, Offset: ${offsetInPage}, Limit: ${dailyLimit}`);
  try {
    console.log('[Lead Search] Checking database (employees_cache) - page', page);
    
    const dbResponse = await axios.post(
      `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
      {
        ...searchParams,
        page: page,
        per_page: 100
      },
      {
        headers: getAuthHeaders(authToken),
        timeout: 60000
      }
    );
    
    if (dbResponse.data && dbResponse.data.success !== false) {
      const dbEmployees = dbResponse.data.employees || dbResponse.data || [];
      console.log(`[Lead Search] Found ${dbEmployees.length} leads in database (page ${page})`);
      
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
    console.error('[Lead Search] ❌ Error fetching from database:', dbError.message);
    if (dbError.response) {
      console.error('[Lead Search] Response status:', dbError.response.status);
      console.error('[Lead Search] Response data:', dbError.response.data);
    }
    if (dbError.code === 'ECONNREFUSED' || dbError.code === 'ENOTFOUND') {
      console.error('[Lead Search] Cannot reach backend server:', BACKEND_URL);
      console.error('[Lead Search] This will cause lead generation to fail silently!');
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
    console.log('[Lead Search] Fetching from Apollo API - page', page);
    
    const apolloParams = {
      ...searchParams,
      page: page,
      per_page: 100
    };
    
    // Try calling Apollo API directly - if endpoint doesn't exist, fallback to database endpoint
    console.log(`[Lead Search] 🔍 Calling Apollo API: ${BACKEND_URL}/api/apollo-leads/search-employees`);
    console.log(`[Lead Search] 📋 Search params:`, JSON.stringify(apolloParams, null, 2));
    
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
      console.log(`[Lead Search] ✅ Apollo API responded with status: ${apolloResponse.status}`);
    } catch (apolloEndpointError) {
      // If Apollo endpoint doesn't exist, use database endpoint which may fetch from Apollo
      console.warn(`[Lead Search] ⚠️  Apollo endpoint failed (${apolloEndpointError.message}), trying database endpoint`);
      if (apolloEndpointError.response) {
        console.warn(`[Lead Search] Response status: ${apolloEndpointError.response.status}`);
        console.warn(`[Lead Search] Response data:`, apolloEndpointError.response.data);
      }
      try {
        apolloResponse = await axios.post(
          `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
          apolloParams,
          {
            headers: getAuthHeaders(authToken),
            timeout: 60000
          }
        );
        console.log(`[Lead Search] ✅ Database endpoint responded with status: ${apolloResponse.status}`);
      } catch (dbEndpointError) {
        console.error(`[Lead Search] ❌ Database endpoint also failed: ${dbEndpointError.message}`);
        if (dbEndpointError.response) {
          console.error(`[Lead Search] Response status: ${dbEndpointError.response.status}`);
          console.error(`[Lead Search] Response data:`, dbEndpointError.response.data);
        }
        throw dbEndpointError; // Re-throw to be caught by outer catch
      }
    }
    
    if (apolloResponse.data && apolloResponse.data.success !== false) {
      const apolloEmployees = apolloResponse.data.employees || apolloResponse.data || [];
      console.log(`[Lead Search] Found ${apolloEmployees.length} leads from Apollo (page ${page})`);
      
      // Apply offset within Apollo page and take what we need
      return apolloEmployees.slice(offsetInPage, offsetInPage + neededCount);
    }
    
    return [];
  } catch (apolloError) {
    console.error('[Lead Search] ❌ Error fetching from Apollo:', apolloError.message);
    if (apolloError.response) {
      console.error('[Lead Search] Response status:', apolloError.response.status);
      console.error('[Lead Search] Response data:', apolloError.response.data);
    }
    if (apolloError.code === 'ECONNREFUSED' || apolloError.code === 'ENOTFOUND') {
      console.error('[Lead Search] Cannot reach backend server:', BACKEND_URL);
      console.error('[Lead Search] This will cause lead generation to fail silently!');
    }
    console.error('[Lead Search] URL tried:', `${BACKEND_URL}/api/apollo-leads/search-employees`);
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
async function searchEmployees(searchParams, page, offsetInPage, dailyLimit, authToken = null) {
  console.log(`[Lead Search] 🚀 Starting employee search...`);
  console.log(`[Lead Search] 📋 Search params:`, JSON.stringify(searchParams, null, 2));
  console.log(`[Lead Search] 📄 Page: ${page}, Offset: ${offsetInPage}, Daily limit: ${dailyLimit}`);
  console.log(`[Lead Search] 🌐 Using BACKEND_URL: ${BACKEND_URL}`);
  
  // STEP 1: Try to get leads from database first
  console.log(`[Lead Search] 📊 STEP 1: Searching database...`);
  const dbResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit, authToken);
  let employees = dbResult.employees;
  let fromSource = dbResult.fromSource;
  
  console.log(`[Lead Search] 📊 Database search result: ${employees.length} leads found (source: ${fromSource})`);
  if (dbResult.error) {
    console.error(`[Lead Search] ⚠️  Database search had error: ${dbResult.error}`);
  }
  
  // STEP 2: If not enough leads from database, fetch from Apollo
  if (employees.length < dailyLimit) {
    const neededFromApollo = dailyLimit - employees.length;
    console.log(`[Lead Search] 📊 STEP 2: Need ${neededFromApollo} more leads, fetching from Apollo...`);
    const apolloEmployees = await searchEmployeesFromApollo(searchParams, page, offsetInPage, neededFromApollo, authToken);
    
    // Combine database leads with Apollo leads
    employees = [...employees, ...apolloEmployees].slice(0, dailyLimit);
    fromSource = employees.length > (dailyLimit - neededFromApollo) ? 'mixed' : 'apollo';
    
    console.log(`[Lead Search] 📊 Combined total: ${employees.length} leads (${employees.length - apolloEmployees.length} from DB, ${apolloEmployees.length} from Apollo)`);
  } else {
    console.log(`[Lead Search] ✅ Got enough leads from database (${employees.length}/${dailyLimit}), skipping Apollo`);
  }
  
  console.log(`[Lead Search] ✅ Final result: ${employees.length} leads from ${fromSource}`);
  return { employees, fromSource };
}

module.exports = {
  searchEmployeesFromDatabase,
  searchEmployeesFromApollo,
  searchEmployees
};

