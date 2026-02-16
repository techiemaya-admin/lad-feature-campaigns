/**
 * Apollo Search History Repository
 * LAD Architecture: SQL queries only - no business logic
 * 
 * Handles all database operations for Apollo search history.
 * This repository contains ONLY SQL queries.
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');

class ApolloSearchHistoryRepository {
  /**
   * Save search history
   * LAD Architecture: SQL only, requires tenant context and uses dynamic schema
   */
  async save(searchData, schema, tenantId) {
    const query = `
      INSERT INTO ${schema}.apollo_search_history 
        (tenant_id, user_id, search_params, results_count, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      tenantId,
      searchData.userId,
      JSON.stringify(searchData.searchParams),
      searchData.results
    ]);

    return result.rows[0];
  }

  /**
   * Get search history
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  async findByUser(userId, tenantId, schema, options = {}) {
    const { limit = 50, offset = 0 } = options;
    
    const query = `
      SELECT id, search_params, results_count, created_at
      FROM ${schema}.apollo_search_history
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
    
    const result = await pool.query(query, [tenantId, userId, limit, offset]);
    
    return result.rows.map(row => ({
      ...row,
      search_params: JSON.parse(row.search_params)
    }));
  }

  /**
   * Delete search history
   * LAD Architecture: Tenant-scoped deletion with dynamic schema
   */
  async delete(historyId, userId, tenantId, schema) {
    const query = `
      DELETE FROM ${schema}.apollo_search_history
      WHERE tenant_id = $1 AND id = $2 AND user_id = $3
      RETURNING id
    `;
    
    const result = await pool.query(query, [tenantId, historyId, userId]);
    return result.rowCount > 0;
  }
}

module.exports = new ApolloSearchHistoryRepository();

