/**
 * Lead Search Service
 * Handles searching for leads from database and Apollo API
 */

const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3004';

/**
 * Search employees from database
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} dailyLimit - Daily limit of leads needed
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit) {
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
        headers: {
          'Content-Type': 'application/json'
        },
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
    console.warn('[Lead Search] Error fetching from database:', dbError.message);
    return { employees: [], fromSource: 'database' };
  }
}

/**
 * Search employees from Apollo API
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} neededCount - Number of leads needed
 * @returns {Array} Array of employees
 */
async function searchEmployeesFromApollo(searchParams, page, offsetInPage, neededCount) {
  try {
    console.log('[Lead Search] Fetching from Apollo API - page', page);
    
    const apolloParams = {
      ...searchParams,
      page: page,
      per_page: 100
    };
    
    // Try calling Apollo API directly - if endpoint doesn't exist, fallback to database endpoint
    let apolloResponse;
    try {
      apolloResponse = await axios.post(
        `${BACKEND_URL}/api/apollo-leads/search-employees`,
        apolloParams,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
    } catch (apolloEndpointError) {
      // If Apollo endpoint doesn't exist, use database endpoint which may fetch from Apollo
      console.log('[Lead Search] Apollo endpoint not available, using database endpoint');
      apolloResponse = await axios.post(
        `${BACKEND_URL}/api/apollo-leads/search-employees-from-db`,
        apolloParams,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );
    }
    
    if (apolloResponse.data && apolloResponse.data.success !== false) {
      const apolloEmployees = apolloResponse.data.employees || apolloResponse.data || [];
      console.log(`[Lead Search] Found ${apolloEmployees.length} leads from Apollo (page ${page})`);
      
      // Apply offset within Apollo page and take what we need
      return apolloEmployees.slice(offsetInPage, offsetInPage + neededCount);
    }
    
    return [];
  } catch (apolloError) {
    console.error('[Lead Search] Error fetching from Apollo:', apolloError.message);
    return [];
  }
}

/**
 * Search for employees combining database and Apollo sources
 * @param {Object} searchParams - Search parameters
 * @param {number} page - Page number
 * @param {number} offsetInPage - Offset within page
 * @param {number} dailyLimit - Daily limit of leads needed
 * @returns {Object} { employees, fromSource }
 */
async function searchEmployees(searchParams, page, offsetInPage, dailyLimit) {
  // STEP 1: Try to get leads from database first
  const dbResult = await searchEmployeesFromDatabase(searchParams, page, offsetInPage, dailyLimit);
  let employees = dbResult.employees;
  let fromSource = dbResult.fromSource;
  
  // STEP 2: If not enough leads from database, fetch from Apollo
  if (employees.length < dailyLimit) {
    const neededFromApollo = dailyLimit - employees.length;
    const apolloEmployees = await searchEmployeesFromApollo(searchParams, page, offsetInPage, neededFromApollo);
    
    // Combine database leads with Apollo leads
    employees = [...employees, ...apolloEmployees].slice(0, dailyLimit);
    fromSource = employees.length > (dailyLimit - neededFromApollo) ? 'mixed' : 'apollo';
    
    console.log(`[Lead Search] Combined total: ${employees.length} leads (${employees.length - apolloEmployees.length} from DB, ${apolloEmployees.length} from Apollo)`);
  }
  
  return { employees, fromSource };
}

module.exports = {
  searchEmployeesFromDatabase,
  searchEmployeesFromApollo,
  searchEmployees
};

