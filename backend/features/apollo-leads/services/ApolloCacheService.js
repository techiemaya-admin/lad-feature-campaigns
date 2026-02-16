/**
 * Apollo Cache Service
 * Handles database cache operations for Apollo leads
 * LAD Architecture Compliant
 */

const { searchEmployeesFromApollo } = require('./ApolloApiService');
const { saveEmployeesToCache, formatApolloEmployees } = require('./ApolloCacheSaveService');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
const ApolloEmployeesCacheRepository = require('../repositories/ApolloEmployeesCacheRepository');
const CompanySearchCacheRepository = require('../repositories/CompanySearchCacheRepository');

/**
 * Filter out excluded IDs from employees list
 * @param {Array} employees - List of employees
 * @param {Array} excludeIds - List of IDs to exclude
 * @returns {Array} Filtered employees
 */
function filterExcludedEmployees(employees, excludeIds) {
  if (!excludeIds || excludeIds.length === 0) return employees;
  
  const excludeSet = new Set(excludeIds);
  return employees.filter(emp => {
    const empId = emp.id || emp.apollo_person_id;
    return empId && !excludeSet.has(empId);
  });
}

/**
 * Search employees from database cache (employees_cache table)
 * Falls back to Apollo API if no results found in database
 * 
 * @param {Object} searchParams - Search parameters
 * @param {Object} req - Express request object (for tenant context and schema)
 * @returns {Promise<Object>} { success, employees, count }
 */
async function searchEmployeesFromDb(searchParams, req = null) {
  const {
    organization_locations = [],
    person_titles = [],
    organization_industries = [],
    per_page = 100,
    page = 1,
    exclude_ids = []  // IDs to exclude (already used leads)
  } = searchParams;

  try {
    // LAD Architecture: Extract tenant context from request
    const tenantId = req?.user?.tenant_id || req?.tenant?.id || req?.headers?.['x-tenant-id'];
    if (!tenantId && process.env.NODE_ENV === 'production') {
      throw new Error('Tenant context required');
    }
    
    // LAD Architecture: Get dynamic schema (no hardcoded lad_dev)
    const schema = getSchema(req);
    
    logger.info('[Apollo Cache] Employee search request received', {
      tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'default',
      schema
    });
    
    // Ensure per_page is at least 1
    const limitedPerPage = Math.max(per_page, 1);
    
    logger.debug('[Apollo Cache] Search parameters', {
      person_titles,
      organization_locations,
      organization_industries,
      page,
      per_page: limitedPerPage
    });
    
    // Require at least one search criteria
    const hasPersonTitles = person_titles && person_titles.length > 0;
    const hasIndustries = organization_industries && organization_industries.length > 0;
    const hasLocations = organization_locations && organization_locations.length > 0;
    
    if (!hasPersonTitles && !hasIndustries && !hasLocations) {
      logger.warn('[Apollo Cache] No search criteria provided');
      throw new Error('At least one search criteria is required (person_titles, organization_industries, or organization_locations)');
    }
    
    logger.debug('[Apollo Cache] Database connection established');
    
    const queryStartTime = Date.now();
    
    // STEP 1: Check if we have companies cached for this industry+location
    let companyDomains = [];
    const hasIndustryFilter = organization_industries && organization_industries.length > 0;
    
    if (hasIndustryFilter && hasLocations) {
      // Get cached company names for industry+location combination
      // Normalize to lowercase for case-insensitive matching
      const industryKeywords = organization_industries[0].toLowerCase(); // Use first industry
      const locationKeywords = organization_locations[0].toLowerCase(); // Use first location (lowercase)
      
      logger.info('[Apollo Cache] Checking company cache for industry+location', {
        industry: industryKeywords,
        location: locationKeywords,
        tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none'
      });
      
      companyDomains = await CompanySearchCacheRepository.getCachedCompanyNames(
        tenantId,
        industryKeywords,
        locationKeywords,
        industryKeywords
      );
      
      if (companyDomains.length > 0) {
        logger.info('[Apollo Cache] Found cached companies', {
          companyCount: companyDomains.length,
          sampleCompanies: companyDomains.slice(0, 5)
        });
      }
    }
    
    // STEP 2: Search employees_cache using company names (if available) or general filters
    let dbQuery;
    const queryParams = [];
    let paramIndex = 1;
    
    if (companyDomains.length > 0) {
      // Search by company names + titles
      dbQuery = `
        SELECT DISTINCT
          ec.apollo_person_id as id,
          ec.employee_name as name,
          ec.employee_title as title,
          ec.employee_email as email,
          ec.employee_phone as phone,
          ec.employee_linkedin_url as linkedin_url,
          ec.employee_photo_url as photo_url,
          ec.employee_headline as headline,
          ec.employee_city as city,
          ec.employee_state as state,
          ec.employee_country as country,
          ec.company_id,
          ec.company_name,
          ec.company_domain,
          ec.employee_data->'organization'->>'linkedin_url' as company_linkedin_url,
          ec.employee_data->'organization'->>'website_url' as company_website_url,
          ec.employee_data->'organization'->>'website' as company_website_url_alt,
          ec.created_at,
          ec.employee_data
        FROM ${schema}.employees_cache ec
        WHERE ec.is_deleted = false
          AND ec.tenant_id = $${paramIndex++}
          AND ec.company_name = ANY($${paramIndex++}::text[])
      `;
      queryParams.push(tenantId, companyDomains);
    } else {
      // Fallback: Search without company filter (broader search)
      dbQuery = `
        SELECT DISTINCT
          ec.apollo_person_id as id,
          ec.employee_name as name,
          ec.employee_title as title,
          ec.employee_email as email,
          ec.employee_phone as phone,
          ec.employee_linkedin_url as linkedin_url,
          ec.employee_photo_url as photo_url,
          ec.employee_headline as headline,
          ec.employee_city as city,
          ec.employee_state as state,
          ec.employee_country as country,
          ec.company_id,
          ec.company_name,
          ec.company_domain,
          ec.employee_data->'organization'->>'linkedin_url' as company_linkedin_url,
          ec.employee_data->'organization'->>'website_url' as company_website_url,
          ec.employee_data->'organization'->>'website' as company_website_url_alt,
          ec.created_at,
          ec.employee_data
        FROM ${schema}.employees_cache ec
        WHERE ec.is_deleted = false
          AND ec.tenant_id = $${paramIndex++}
      `;
      queryParams.push(tenantId);
    }
    
    // Filter by person titles (designation)
    if (hasPersonTitles) {
      const titleConditions = person_titles.map(title => {
        const titlePattern = `%${title.toLowerCase()}%`;
        queryParams.push(titlePattern);
        const titleParam = paramIndex++;
        queryParams.push(titlePattern);
        const dataTitleParam = paramIndex++;
        return `(LOWER(ec.employee_title) LIKE $${titleParam} OR LOWER(ec.employee_data->>'title') LIKE $${dataTitleParam})`;
      });
      dbQuery += ` AND (${titleConditions.join(' OR ')})`;
    }
    
    // Filter by location (person or organization location)
    if (hasLocations) {
      const locationConditions = organization_locations.map(location => {
        queryParams.push(`%${location.toLowerCase()}%`);
        const cityParam = paramIndex++;
        queryParams.push(`%${location.toLowerCase()}%`);
        const stateParam = paramIndex++;
        queryParams.push(`%${location.toLowerCase()}%`);
        const countryParam = paramIndex++;
        queryParams.push(`%${location.toLowerCase()}%`);
        const orgLocationParam = paramIndex++;
        
        return `(
          LOWER(COALESCE(ec.employee_city, '')) LIKE $${cityParam}
          OR LOWER(COALESCE(ec.employee_state, '')) LIKE $${stateParam}
          OR LOWER(COALESCE(ec.employee_country, '')) LIKE $${countryParam}
          OR LOWER(COALESCE(ec.employee_data->'organization'->>'location', '')) LIKE $${orgLocationParam}
        )`;
      });
      dbQuery += ` AND (${locationConditions.join(' OR ')})`;
    }
    
    // Exclude already used leads
    if (exclude_ids && exclude_ids.length > 0) {
      queryParams.push(exclude_ids);
      dbQuery += ` AND ec.apollo_person_id NOT IN (SELECT UNNEST($${paramIndex++}::text[]))`;
    }
    
    // Limit to check availability (get up to 1000 to assess cache depth)
    dbQuery += ` ORDER BY ec.created_at DESC LIMIT $${paramIndex++}`;
    queryParams.push(1000);
    
    const { pool } = require('../../../shared/database/connection');
    const result = await pool.query(dbQuery, queryParams);
    const allCachedRows = result.rows;
    
    const queryDuration = Date.now() - queryStartTime;
    
    logger.info('[Apollo Cache] Cache availability check', {
      duration: `${queryDuration}ms`,
      totalCached: allCachedRows.length,
      excludedCount: exclude_ids.length,
      requested: limitedPerPage,
      usedCompanyCache: companyDomains.length > 0,
      companyCount: companyDomains.length
    });
    
    // STEP 2: Now get the paginated subset if we have enough
    let dbRows = allCachedRows;
    if (allCachedRows.length > limitedPerPage) {
      // Apply pagination to the cached results
      const startIndex = (page - 1) * limitedPerPage;
      const endIndex = startIndex + limitedPerPage;
      dbRows = allCachedRows.slice(startIndex, endIndex);
      logger.info('[Apollo Cache] Applying pagination to cached results', {
        total: allCachedRows.length,
        page,
        perPage: limitedPerPage,
        returned: dbRows.length
      });
    }
    
    let employees = [];
    
    // STEP 3: If database has ENOUGH unique results (>= requested), use them
    if (dbRows.length >= limitedPerPage) {
      logger.info('[Apollo Cache] Found sufficient unique employees in database cache', { 
        cached: allCachedRows.length,
        afterExclusion: dbRows.length, 
        requested: limitedPerPage 
      });
      employees = dbRows.map(row => {
        let employeeData = {};
        try {
          employeeData = row.employee_data ? 
            (typeof row.employee_data === 'string' ? JSON.parse(row.employee_data) : row.employee_data) 
            : {};
        } catch (e) {
          logger.warn('[Apollo Cache] Error parsing employee_data', { error: e.message });
        }
        
        return {
          id: row.id,
          name: row.name,
          title: row.title,
          email: row.email,
          phone: row.phone,
          linkedin_url: row.linkedin_url,
          photo_url: row.photo_url,
          headline: row.headline,
          city: row.city,
          state: row.state,
          country: row.country,
          company_id: row.company_id,
          company_name: row.company_name,
          company_domain: row.company_domain,
          company_linkedin_url: row.company_linkedin_url,
          company_website_url: row.company_website_url || row.company_website_url_alt,
          organization: employeeData.organization || {},
          employee_data: employeeData
        };
      });
    } else {
      // STEP 2: If database has INSUFFICIENT results (< requested), call Apollo API
      // First, map any DB results we do have
      const dbEmployees = dbRows.map(row => {
        let employeeData = {};
        try {
          employeeData = row.employee_data ? 
            (typeof row.employee_data === 'string' ? JSON.parse(row.employee_data) : row.employee_data) 
            : {};
        } catch (e) {
          logger.warn('[Apollo Cache] Error parsing employee_data', { error: e.message });
        }
        
        return {
          id: row.id,
          name: row.name,
          title: row.title,
          email: row.email,
          phone: row.phone,
          linkedin_url: row.linkedin_url,
          photo_url: row.photo_url,
          headline: row.headline,
          city: row.city,
          state: row.state,
          country: row.country,
          company_id: row.company_id,
          company_name: row.company_name,
          company_domain: row.company_domain,
          company_linkedin_url: row.company_linkedin_url,
          company_website_url: row.company_website_url || row.company_website_url_alt,
          organization: employeeData.organization || {},
          employee_data: employeeData
        };
      });
      
      const neededFromApollo = limitedPerPage - dbEmployees.length;
      logger.info('[Apollo Cache] Insufficient unique cached leads, calling Apollo API', { 
        totalCached: allCachedRows.length,
        uniqueAfterExclusion: dbEmployees.length,
        requested: limitedPerPage, 
        neededFromApollo,
        excludedCount: exclude_ids.length,
        tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none'
      });
      
      // Retry with different pages if all results are filtered out by exclude_ids
      let currentPage = page || 1;
      const maxRetries = 5; // Try up to 5 different pages
      let retryCount = 0;
      let formattedApolloEmployees = [];
      
      while (formattedApolloEmployees.length < neededFromApollo && retryCount < maxRetries) {
        try {
          const apolloResult = await searchEmployeesFromApollo({
            organization_locations: organization_locations,
            person_titles: person_titles,
            organization_industries: organization_industries,
            per_page: 100, // Always request 100 from Apollo
            page: currentPage
          }, tenantId);  // Pass tenantId for company search caching
          
          if (apolloResult && apolloResult.success && apolloResult.employees && apolloResult.employees.length > 0) {
            let apolloEmployees = apolloResult.employees;
            logger.info('[Apollo Cache] Found employees from Apollo API', { 
              count: apolloEmployees.length,
              page: currentPage,
              retryCount
            });
            
            // Format Apollo employees
            let pageEmployees = formatApolloEmployees(apolloEmployees);
            
            // Filter out excluded IDs from Apollo results
            const beforeFilter = pageEmployees.length;
            pageEmployees = filterExcludedEmployees(pageEmployees, exclude_ids);
            logger.info('[Apollo Cache] After filtering excluded IDs from Apollo', { 
              count: pageEmployees.length,
              beforeFilter,
              filtered: beforeFilter - pageEmployees.length,
              page: currentPage
            });
            
            // Add to accumulated results
            formattedApolloEmployees = [...formattedApolloEmployees, ...pageEmployees];
            
            // If Apollo returned no results, stop retrying (no more data available)
            if (apolloEmployees.length === 0) {
              logger.info('[Apollo Cache] Apollo returned no results, stopping pagination', { 
                page: currentPage,
                totalCollected: formattedApolloEmployees.length
              });
              break;
            }
            
            // If we got enough results, stop retrying
            if (formattedApolloEmployees.length >= neededFromApollo) {
              logger.info('[Apollo Cache] Collected enough results, stopping pagination', { 
                needed: neededFromApollo,
                collected: formattedApolloEmployees.length,
                pages: currentPage
              });
              break;
            }
            
            // Need more results - try next page
            logger.info('[Apollo Cache] Need more results, trying next page', { 
              needed: neededFromApollo,
              collected: formattedApolloEmployees.length,
              nextPage: currentPage + 1,
              retryCount: retryCount + 1
            });
            currentPage++;
            retryCount++;
          } else {
            // No Apollo results, stop retrying
            logger.warn('[Apollo Cache] Apollo API returned no employees', {
              hasResult: !!apolloResult,
              hasSuccess: apolloResult?.success,
              hasEmployees: !!apolloResult?.employees,
              employeesLength: apolloResult?.employees?.length || 0,
              page: currentPage
            });
            break;
          }
        } catch (apolloError) {
          // Apollo failed, stop retrying
          logger.error('[Apollo Cache] Error calling Apollo API', {
            message: apolloError.message,
            status: apolloError.response?.status,
            page: currentPage,
            retryCount
          });
          break;
        }
      }
      
      // STEP 3: Save Apollo results to database cache for future use
      if (formattedApolloEmployees.length > 0) {
        try {
          await saveEmployeesToCache(formattedApolloEmployees, req);
          logger.info('[Apollo Cache] Saved employees to cache', { count: formattedApolloEmployees.length });
        } catch (saveError) {
          logger.error('[Apollo Cache] Error saving to cache', { error: saveError.message });
          // Continue - we still return the Apollo results even if cache save fails
        }
      }
      
      // STEP 4: Combine DB employees with Apollo employees
      // Take what we need from Apollo to fill up to limitedPerPage
      const apolloToTake = formattedApolloEmployees.slice(0, neededFromApollo);
      employees = [...dbEmployees, ...apolloToTake].slice(0, limitedPerPage);
      
      logger.info('[Apollo Cache] Combined DB and Apollo results', {
        dbCount: dbEmployees.length,
        apolloCount: apolloToTake.length,
        totalCount: employees.length,
        totalRetriesUsed: retryCount
      });
    }
    
    logger.info('[Apollo Cache] Returning employees', { count: employees.length });
    
    return {
      success: true,
      employees: employees,
      count: employees.length
    };
    
  } catch (error) {
    logger.error('[Apollo Cache] Error in searchEmployeesFromDb', {
      message: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

module.exports = {
  searchEmployeesFromDb
};

