/**
 * Company Search Cache Repository
 * Handles caching of Apollo company search results to avoid duplicate API calls
 * and store company domains for the 2-step industry-based people search
 */

const db = require('../../../config/database');
const logger = require('../../../core/utils/logger');

class CompanySearchCacheRepository {
  /**
   * Get cached companies for a search query
   * @param {string} tenantId - Tenant ID
   * @param {string} keywords - Search keywords (industry keywords)
   * @param {string|null} location - Location filter
   * @param {string|null} industry - Industry filter
   * @returns {Promise<Array>} Cached companies
   */
  static async getCachedCompanies(tenantId, keywords, location = null, industry = null) {
    try {
      const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
      
      const query = `
        SELECT 
          id,
          apollo_organization_id,
          company_name,
          company_domain,
          company_data,
          page_number,
          access_count,
          last_accessed_at,
          created_at
        FROM ${schema}.company_search_cache
        WHERE tenant_id = $1
          AND search_keywords = $2
          AND (search_location = $3 OR ($3 IS NULL AND search_location IS NULL))
          AND (search_industry = $4 OR ($4 IS NULL AND search_industry IS NULL))
        ORDER BY page_number, id
      `;
      
      const result = await db.query(query, [tenantId, keywords, location, industry]);
      
      if (result.rows.length > 0) {
        // Update access count and last_accessed_at for retrieved records
        const ids = result.rows.map(r => r.id);
        await db.query(`
          UPDATE ${schema}.company_search_cache
          SET access_count = access_count + 1,
              last_accessed_at = NOW()
          WHERE id = ANY($1)
        `, [ids]);
        
        logger.info('[CompanySearchCache] Cache hit', {
          tenantId: tenantId.substring(0, 8) + '...',
          keywords,
          location,
          industry,
          count: result.rows.length
        });
      }
      
      return result.rows;
    } catch (error) {
      logger.error('[CompanySearchCache] Error getting cached companies', {
        error: error.message,
        tenantId: tenantId?.substring(0, 8) + '...'
      });
      return [];
    }
  }

  /**
   * Get cached company domains for a search query
   * @param {string} tenantId - Tenant ID
   * @param {string} keywords - Search keywords
   * @param {string|null} location - Location filter
   * @param {string|null} industry - Industry filter
   * @returns {Promise<Array<string>>} List of company domains
   */
  static async getCachedDomains(tenantId, keywords, location = null, industry = null) {
    const companies = await this.getCachedCompanies(tenantId, keywords, location, industry);
    return companies
      .map(c => c.company_domain)
      .filter(domain => domain && domain.length > 0);
  }

  /**
   * Get cached company names for a search query
   * @param {string} tenantId - Tenant ID
   * @param {string} keywords - Search keywords
   * @param {string|null} location - Location filter
   * @param {string|null} industry - Industry filter
   * @returns {Promise<Array<string>>} List of company names
   */
  static async getCachedCompanyNames(tenantId, keywords, location = null, industry = null) {
    const companies = await this.getCachedCompanies(tenantId, keywords, location, industry);
    return companies
      .map(c => c.company_name)
      .filter(name => name && name.length > 0);
  }

  /**
   * Save companies to cache (upsert - avoid duplicates)
   * @param {string} tenantId - Tenant ID
   * @param {string} keywords - Search keywords
   * @param {string|null} location - Location filter
   * @param {string|null} industry - Industry filter
   * @param {Array} companies - Array of company objects from Apollo
   * @param {number} pageNumber - Page number for pagination
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  static async saveCompanies(tenantId, keywords, location, industry, companies, pageNumber = 1) {
    if (!companies || companies.length === 0) {
      return { inserted: 0, updated: 0 };
    }
    
    const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
    let inserted = 0;
    let updated = 0;
    
    try {
      for (const company of companies) {
        const apolloOrgId = company.id || company.organization_id || null;
        const companyName = company.name || company.organization_name || null;
        const companyDomain = this.extractDomain(company.primary_domain || company.website_url);
        
        // Prepare company data JSON (exclude large fields to save space)
        const companyData = {
          id: company.id,
          name: company.name,
          primary_domain: company.primary_domain,
          website_url: company.website_url,
          industry: company.industry,
          industry_tag_id: company.industry_tag_id,
          estimated_num_employees: company.estimated_num_employees,
          city: company.city,
          state: company.state,
          country: company.country,
          linkedin_url: company.linkedin_url,
          logo_url: company.logo_url,
          phone: company.phone,
          founded_year: company.founded_year,
          keywords: company.keywords,
          seo_description: company.seo_description
        };
        
        // Upsert query - update if exists, insert if not
        const upsertQuery = `
          INSERT INTO ${schema}.company_search_cache (
            tenant_id,
            search_keywords,
            search_location,
            search_industry,
            apollo_organization_id,
            company_name,
            company_domain,
            company_data,
            page_number,
            access_count,
            last_accessed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())
          ON CONFLICT (tenant_id, search_keywords, search_location, apollo_organization_id, page_number)
          DO UPDATE SET
            company_name = EXCLUDED.company_name,
            company_domain = EXCLUDED.company_domain,
            company_data = EXCLUDED.company_data,
            access_count = ${schema}.company_search_cache.access_count + 1,
            last_accessed_at = NOW()
          RETURNING (xmax = 0) AS is_insert
        `;
        
        const result = await db.query(upsertQuery, [
          tenantId,
          keywords,
          location,
          industry,
          apolloOrgId,
          companyName,
          companyDomain,
          JSON.stringify(companyData),
          pageNumber
        ]);
        
        if (result.rows[0]?.is_insert) {
          inserted++;
        } else {
          updated++;
        }
      }
      
      logger.info('[CompanySearchCache] Saved companies to cache', {
        tenantId: tenantId.substring(0, 8) + '...',
        keywords,
        location,
        industry,
        inserted,
        updated,
        total: companies.length
      });
      
      return { inserted, updated };
    } catch (error) {
      logger.error('[CompanySearchCache] Error saving companies to cache', {
        error: error.message,
        tenantId: tenantId?.substring(0, 8) + '...'
      });
      throw error;
    }
  }

  /**
   * Extract clean domain from URL or domain string
   * @param {string} urlOrDomain - URL or domain
   * @returns {string|null} Clean domain
   */
  static extractDomain(urlOrDomain) {
    if (!urlOrDomain) return null;
    
    return urlOrDomain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase()
      .trim();
  }

  /**
   * Check if cache exists and is fresh (within TTL)
   * @param {string} tenantId - Tenant ID
   * @param {string} keywords - Search keywords
   * @param {string|null} location - Location filter
   * @param {string|null} industry - Industry filter
   * @param {number} ttlHours - Cache TTL in hours (default 24)
   * @returns {Promise<boolean>} True if fresh cache exists
   */
  static async hasFreshCache(tenantId, keywords, location = null, industry = null, ttlHours = 24) {
    try {
      const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
      
      const query = `
        SELECT COUNT(*) as count
        FROM ${schema}.company_search_cache
        WHERE tenant_id = $1
          AND search_keywords = $2
          AND (search_location = $3 OR ($3 IS NULL AND search_location IS NULL))
          AND (search_industry = $4 OR ($4 IS NULL AND search_industry IS NULL))
          AND created_at > NOW() - INTERVAL '${ttlHours} hours'
      `;
      
      const result = await db.query(query, [tenantId, keywords, location, industry]);
      return parseInt(result.rows[0]?.count || 0) > 0;
    } catch (error) {
      logger.error('[CompanySearchCache] Error checking cache freshness', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get cache statistics for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Cache statistics
   */
  static async getCacheStats(tenantId) {
    try {
      const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
      
      const query = `
        SELECT 
          COUNT(*) as total_cached,
          COUNT(DISTINCT company_domain) as unique_domains,
          COUNT(DISTINCT search_keywords) as unique_searches,
          SUM(access_count) as total_accesses,
          MAX(last_accessed_at) as last_accessed,
          MIN(created_at) as oldest_entry,
          MAX(created_at) as newest_entry
        FROM ${schema}.company_search_cache
        WHERE tenant_id = $1
      `;
      
      const result = await db.query(query, [tenantId]);
      return result.rows[0] || {};
    } catch (error) {
      logger.error('[CompanySearchCache] Error getting cache stats', {
        error: error.message
      });
      return {};
    }
  }

  /**
   * Clean old cache entries
   * @param {number} olderThanDays - Delete entries older than this many days
   * @returns {Promise<number>} Number of deleted entries
   */
  static async cleanOldCache(olderThanDays = 30) {
    try {
      const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
      
      const query = `
        DELETE FROM ${schema}.company_search_cache
        WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
        RETURNING id
      `;
      
      const result = await db.query(query);
      
      logger.info('[CompanySearchCache] Cleaned old cache entries', {
        deleted: result.rowCount
      });
      
      return result.rowCount;
    } catch (error) {
      logger.error('[CompanySearchCache] Error cleaning old cache', {
        error: error.message
      });
      return 0;
    }
  }
}

module.exports = CompanySearchCacheRepository;
