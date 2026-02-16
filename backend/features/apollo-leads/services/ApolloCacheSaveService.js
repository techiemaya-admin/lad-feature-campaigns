/**
 * Apollo Cache Save Service
 * Handles saving Apollo results to database cache
 * LAD Architecture Compliant
 */

/**
 * Apollo Cache Save Service
 * LAD Architecture Compliant - Business logic only, calls repository for SQL
 * 
 * Handles saving Apollo results to database cache.
 */

const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
const ApolloEmployeesCacheRepository = require('../repositories/ApolloEmployeesCacheRepository');
const ApolloCompanyRepository = require('../repositories/ApolloCompanyRepository');

/**
 * Save Apollo employees to database cache
 * LAD Architecture: Business logic only - delegates SQL to repository
 * @param {Array} employees - Array of employee objects
 * @param {Object} req - Express request object (for tenant context)
 */
async function saveEmployeesToCache(employees, req = null) {
  let savedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  
  try {
    // LAD Architecture: Require tenant context (throws error if missing in production)
    const { requireTenantId } = require('../../../core/utils/tenantHelper');
    const effectiveTenantId = requireTenantId(null, req, 'saveEmployeesToCache');
    
    // LAD Architecture: Get dynamic schema (no hardcoded lad_dev)
    const schema = getSchema(req);
    
    // Track unique companies to save
    const uniqueCompanies = new Map();
    
    for (const emp of employees) {
      try {
        const apolloPersonId = String(emp.id || emp.person_id || '');
        if (!apolloPersonId || apolloPersonId === '') {
          logger.warn('[Apollo Cache Save] Skipping employee with no apollo_person_id', { name: emp.name });
          errorCount++;
          continue;
        }
        
        // Extract company data from employee
        const companyId = emp.organization?.id || emp.company_id;
        const companyData = emp.organization || {};
        
        // Save company first if we have company data
        if (companyId && !uniqueCompanies.has(companyId)) {
          uniqueCompanies.set(companyId, {
            apolloId: String(companyId),
            name: companyData.name || emp.company_name,
            domain: companyData.primary_domain || companyData.domain || emp.company_domain,
            industry: companyData.industry || companyData.industries?.[0] || null,
            employeeCount: companyData.estimated_num_employees || null,
            revenue: companyData.estimated_annual_revenue || null,
            location: companyData.city || companyData.state || companyData.country || null,
            phone: companyData.phone || null,
            website: companyData.website_url || null,
            enrichedData: companyData,
            userId: req?.user?.userId || null,
            metadata: {}
          });
        }
        
        // LAD Architecture: Delegate SQL to repository
        const result = await ApolloEmployeesCacheRepository.upsertEmployee({
          apolloPersonId,
          name: emp.name || null,
          title: emp.title || null,
          email: emp.email || null,
          phone: emp.phone || emp.sanitized_phone || null,
          linkedin_url: emp.linkedin_url || null,
          photo_url: emp.photo_url || null,
          headline: emp.headline || null,
          city: emp.city || null,
          state: emp.state || null,
          country: emp.country || null,
          company_id: emp.company_id || null,
          company_name: emp.company_name || null,
          company_domain: emp.company_domain || null,
          data_source: 'apollo_io',
          // Store complete Apollo data including enrichment fields
          employee_data: {
            ...(emp.employee_data || emp || {}),
            // Ensure enrichment data is preserved
            personal_emails: emp.personal_emails,
            phone_numbers: emp.phone_numbers,
            sanitized_phone: emp.sanitized_phone,
            employment_history: emp.employment_history,
            education: emp.education,
            seniority: emp.seniority,
            departments: emp.departments,
            functions: emp.functions,
            organization: emp.organization,
            is_enriched: emp.is_enriched,
            enriched_at: emp.enriched_at,
            _enriched_data: emp._enriched_data
          }
        }, schema, effectiveTenantId);
        
        if (result.command === 'INSERT') {
          savedCount++;
        } else {
          updatedCount++;
        }
      } catch (saveError) {
        errorCount++;
        logger.warn('[Apollo Cache Save] Failed to save employee', {
          id: emp.id || emp.name,
          error: saveError.message
        });
        if (saveError.code === '23505') {
          // Unique constraint violation - this is okay, it means the record already exists
          logger.debug('[Apollo Cache Save] Record already exists, skipping');
        }
      }
    }
    
    // Save unique companies to apollo_companies table
    let companiesSaved = 0;
    for (const [companyId, companyData] of uniqueCompanies) {
      try {
        await ApolloCompanyRepository.upsert(companyData, schema, effectiveTenantId);
        companiesSaved++;
      } catch (companyError) {
        logger.warn('[Apollo Cache Save] Failed to save company', {
          companyId,
          name: companyData.name,
          error: companyError.message
        });
      }
    }
    
    logger.info('[Apollo Cache Save] Save operation completed', {
      saved: savedCount,
      updated: updatedCount,
      errors: errorCount,
      companiesSaved,
      total: employees.length
    });
    
    return { savedCount, updatedCount, errorCount };
  } catch (saveError) {
    logger.error('[Apollo Cache Save] Error saving to cache', {
      message: saveError.message,
      stack: saveError.stack
    });
    throw saveError;
  }
}

/**
 * Format Apollo employees for database storage
 */
function formatApolloEmployees(apolloEmployees) {
  return apolloEmployees.map(emp => {
    // Construct LinkedIn URL if not provided
    // Apollo's people_api can return LinkedIn URL in multiple field names
    let linkedinUrl = emp.linkedin_url 
      || emp.linkedin 
      || emp.linkedin_profile_url
      || emp.linkedin_profile_link
      || emp.linkedin_link
      || emp.profile_url
      || (emp.social_profiles && emp.social_profiles.linkedin);
    
    if (!linkedinUrl && emp.social_profiles && Array.isArray(emp.social_profiles)) {
      // If social_profiles is an array, find LinkedIn profile
      const linkedinProfile = emp.social_profiles.find(p => 
        p && (p.url.includes('linkedin') || p.name === 'linkedin')
      );
      if (linkedinProfile) {
        linkedinUrl = linkedinProfile.url;
      }
    }
    
    // REMOVED: Do NOT construct fake LinkedIn URLs from names
    // Apollo should provide real LinkedIn URLs - if missing, leave as null
    // Constructing URLs like "linkedin.com/in/firstname-lastname" leads to invalid profiles
    
    return {
      id: emp.id || emp.person_id,
      name: emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
      title: emp.title || emp.job_title,
      email: emp.email || emp.work_email,
      phone: emp.phone_number || emp.phone,
      linkedin_url: linkedinUrl,
      photo_url: emp.photo_url || emp.photo,
      headline: emp.headline || emp.job_title,
      city: emp.city,
      state: emp.state,
      country: emp.country,
      company_id: emp.organization?.id || emp.company_id,
      company_name: emp.organization?.name || emp.company_name,
      company_domain: emp.organization?.domain || emp.company_domain,
      company_linkedin_url: emp.organization?.linkedin_url || emp.organization?.linkedin,
      company_website_url: emp.organization?.website_url || emp.organization?.website,
      employee_data: emp
    };
  });
}

module.exports = {
  saveEmployeesToCache,
  formatApolloEmployees
};

