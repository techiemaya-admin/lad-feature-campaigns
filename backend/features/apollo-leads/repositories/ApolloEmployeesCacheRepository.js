/**
 * Apollo Employees Cache Repository
 * LAD Architecture: SQL queries only - no business logic
 * 
 * Handles all database operations for Apollo employees cache.
 * This repository contains ONLY SQL queries.
 */

const { pool } = require('../../../shared/database/connection');

class ApolloEmployeesCacheRepository {
  /**
   * Upsert employee to cache
   * LAD Architecture: SQL only, uses dynamic schema and tenant_id
   */
  async upsertEmployee(employeeData, schema, tenantId) {
    const query = `
      INSERT INTO ${schema}.employees_cache (
        tenant_id, apollo_person_id, employee_name, employee_title, employee_email,
        employee_phone, employee_linkedin_url, employee_photo_url,
        employee_headline, employee_city, employee_state, employee_country,
        company_id, company_name, company_domain, data_source, employee_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (tenant_id, company_id, apollo_person_id) DO UPDATE SET
        employee_name = EXCLUDED.employee_name,
        employee_title = EXCLUDED.employee_title,
        employee_email = COALESCE(EXCLUDED.employee_email, employees_cache.employee_email),
        employee_phone = COALESCE(EXCLUDED.employee_phone, employees_cache.employee_phone),
        employee_linkedin_url = COALESCE(EXCLUDED.employee_linkedin_url, employees_cache.employee_linkedin_url),
        employee_photo_url = COALESCE(EXCLUDED.employee_photo_url, employees_cache.employee_photo_url),
        employee_headline = COALESCE(EXCLUDED.employee_headline, employees_cache.employee_headline),
        employee_city = COALESCE(EXCLUDED.employee_city, employees_cache.employee_city),
        employee_state = COALESCE(EXCLUDED.employee_state, employees_cache.employee_state),
        employee_country = COALESCE(EXCLUDED.employee_country, employees_cache.employee_country),
        company_name = COALESCE(EXCLUDED.company_name, employees_cache.company_name),
        company_domain = COALESCE(EXCLUDED.company_domain, employees_cache.company_domain),
        employee_data = EXCLUDED.employee_data,
        updated_at = NOW()
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      tenantId,
      employeeData.apolloPersonId,
      employeeData.name || null,
      employeeData.title || null,
      employeeData.email || null,
      employeeData.phone || null,
      employeeData.linkedin_url || null,
      employeeData.photo_url || null,
      employeeData.headline || null,
      employeeData.city || null,
      employeeData.state || null,
      employeeData.country || null,
      employeeData.company_id || null,
      employeeData.company_name || null,
      employeeData.company_domain || null,
      employeeData.data_source || 'apollo_io',
      JSON.stringify(employeeData.employee_data || employeeData || {})
    ]);

    return {
      command: result.command,
      row: result.rows[0]
    };
  }

  /**
   * Search employees from cache with filters
   * LAD Architecture: SQL only, uses dynamic schema and tenant scoping
   */
  async searchEmployees(searchParams, schema, tenantId) {
    const {
      person_titles = [],
      organization_locations = [],
      organization_industries = [],
      per_page = 100,
      page = 1
    } = searchParams;

    // Build query to search employees_cache
    // JOIN with apollo_companies to access industry data
    // NOTE: When using SELECT DISTINCT, ORDER BY columns must be in SELECT list (created_at is included)
    let dbQuery = `
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
      LEFT JOIN ${schema}.apollo_companies ac ON ec.company_id = ac.apollo_id AND ec.tenant_id = ac.tenant_id
      WHERE ec.is_deleted = false
    `;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Add tenant scoping to prevent data leakage
    if (tenantId) {
      dbQuery += ` AND ec.tenant_id = $${paramIndex}`;
      queryParams.push(tenantId);
      paramIndex++;
    }
    
    // Filter by job titles (case-insensitive, partial match)
    if (person_titles.length > 0) {
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
    
    // Filter by organization locations
    if (organization_locations && organization_locations.length > 0) {
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
    
    // Filter by industry/company keywords
    // Check both apollo_companies.industry and employee company names
    if (organization_industries && organization_industries.length > 0) {
      const industryConditions = organization_industries.map(industry => {
        const industryPattern = `%${industry.toLowerCase()}%`;
        
        queryParams.push(industryPattern);
        const acIndustryParam = paramIndex++;
        queryParams.push(industryPattern);
        const companyNameParam = paramIndex++;
        queryParams.push(industryPattern);
        const orgNameParam = paramIndex++;
        
        return `(
              LOWER(COALESCE(ac.industry, '')) LIKE $${acIndustryParam}
              OR LOWER(ec.company_name) LIKE $${companyNameParam}
              OR LOWER(COALESCE(ec.employee_data->'organization'->>'name', '')) LIKE $${orgNameParam}
            )`;
      });
      dbQuery += ` AND (${industryConditions.join(' OR ')})`;
    }
    
    // Filter out excluded IDs (leads already used in campaigns)
    if (searchParams.exclude_ids && searchParams.exclude_ids.length > 0) {
      // Use ANY with array parameter for efficient exclusion
      queryParams.push(searchParams.exclude_ids);
      dbQuery += ` AND ec.apollo_person_id NOT IN (SELECT UNNEST($${paramIndex++}::text[]))`;
    }
    
    // Add pagination
    const offset = (page - 1) * per_page;
    dbQuery += ` ORDER BY ec.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    queryParams.push(per_page);
    queryParams.push(offset);
    
    const result = await pool.query(dbQuery, queryParams);
    return result.rows;
  }

  /**
   * Find employee by person ID and tenant
   * LAD Architecture: SQL only, tenant-scoped query
   * If tenantId is null, searches across all tenants (for webhook lookups)
   */
  async findByPersonId(personId, tenantId, schema) {
    const schemaSafe = schema || 'lad_dev';
    
    let query;
    let params;
    
    if (tenantId) {
      // Normal lookup with tenant scope
      query = `
        SELECT *
        FROM ${schemaSafe}.employees_cache
        WHERE apollo_person_id = $1 AND tenant_id = $2
        LIMIT 1
      `;
      params = [String(personId), tenantId];
    } else {
      // Webhook lookup - no tenant scope
      query = `
        SELECT *
        FROM ${schemaSafe}.employees_cache
        WHERE apollo_person_id = $1
        LIMIT 1
      `;
      params = [String(personId)];
    }
    
    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Find employee by name and tenant
   * LAD Architecture: SQL only, tenant-scoped query
   */
  async findByName(employeeName, tenantId, schema) {
    const query = `
      SELECT employee_email, employee_name, employee_phone
      FROM ${schema}.employees_cache
      WHERE employee_name = $1 AND tenant_id = $2
        AND (employee_email IS NOT NULL AND employee_email != '' AND employee_phone IS NOT NULL AND employee_phone != '')
      LIMIT 1
    `;
    
    const result = await pool.query(query, [employeeName, tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Update employee email
   * LAD Architecture: SQL only, tenant-scoped update
   */
  async updateEmail(personId, email, tenantId, schema) {
    const query = `
      UPDATE ${schema}.employees_cache
      SET employee_email = $1, updated_at = NOW()
      WHERE apollo_person_id = $2 AND tenant_id = $3
    `;
    
    const result = await pool.query(query, [email, String(personId), tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Update employee phone
   * LAD Architecture: SQL only, tenant-scoped update
   */
  async updatePhone(personId, phone, tenantId, schema) {
    const query = `
      UPDATE ${schema}.employees_cache
      SET employee_phone = $1, updated_at = NOW()
      WHERE apollo_person_id = $2 AND tenant_id = $3
    `;
    
    const result = await pool.query(query, [phone, String(personId), tenantId]);
    return result.rowCount > 0;
  }
}

module.exports = new ApolloEmployeesCacheRepository();

