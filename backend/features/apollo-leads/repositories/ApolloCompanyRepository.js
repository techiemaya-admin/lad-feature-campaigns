/**
 * Apollo Company Repository
 * LAD Architecture: SQL queries only - no business logic
 * 
 * Handles all database operations for Apollo companies.
 * This repository contains ONLY SQL queries.
 */

const { pool } = require('../../../shared/database/connection');

class ApolloCompanyRepository {
  /**
   * Upsert company (insert or update)
   * LAD Architecture: SQL only, uses dynamic schema and tenant_id
   */
  async upsert(companyData, schema, tenantId) {
    const {
      apolloId,
      name,
      domain,
      industry,
      employeeCount,
      revenue,
      location,
      phone,
      website,
      enrichedData,
      userId,
      metadata = {},
      is_deleted = false
    } = companyData;

    const result = await pool.query(`
      INSERT INTO ${schema}.apollo_companies (
        apollo_id,
        name,
        domain,
        industry,
        employee_count,
        revenue,
        location,
        phone,
        website,
        enriched_data,
        tenant_id,
        user_id,
        metadata,
        is_deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (apollo_id, tenant_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        domain = EXCLUDED.domain,
        industry = EXCLUDED.industry,
        employee_count = EXCLUDED.employee_count,
        revenue = EXCLUDED.revenue,
        location = EXCLUDED.location,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        enriched_data = EXCLUDED.enriched_data,
        metadata = EXCLUDED.metadata,
        is_deleted = EXCLUDED.is_deleted,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      apolloId,
      name,
      domain,
      industry,
      employeeCount,
      revenue,
      location,
      phone,
      website,
      JSON.stringify(enrichedData),
      tenantId,
      userId,
      JSON.stringify(metadata),
      is_deleted
    ]);

    return result.rows[0];
  }

  /**
   * Find company by Apollo ID and tenant
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  async findByApolloId(apolloId, tenantId, schema) {
    const result = await pool.query(`
      SELECT * FROM ${schema}.apollo_companies
      WHERE apollo_id = $1 AND tenant_id = $2 AND is_deleted = false
    `, [apolloId, tenantId]);

    return result.rows[0] || null;
  }

  /**
   * Find companies by tenant
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  async findByTenant(tenantId, schema, options = {}) {
    const { limit = 50, offset = 0 } = options;

    const result = await pool.query(`
      SELECT * FROM ${schema}.apollo_companies
      WHERE tenant_id = $1 AND is_deleted = false
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
    `, [tenantId, limit, offset]);

    return result.rows;
  }
}

module.exports = new ApolloCompanyRepository();

