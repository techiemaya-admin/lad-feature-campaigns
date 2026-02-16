/**
 * Apollo Search Cache Repository
 * LAD Architecture: SQL queries only - no business logic
 * 
 * Handles all database operations for Apollo search cache.
 * This repository contains ONLY SQL queries.
 */

const { pool } = require('../../../shared/database/connection');

class ApolloSearchCacheRepository {
  /**
   * Upsert search cache entry
   * LAD Architecture: SQL only, uses dynamic schema and tenant_id
   */
  async upsert(cacheData, schema, tenantId) {
    const {
      searchKey,
      results,
      userId,
      metadata = {},
      is_deleted = false
    } = cacheData;

    const result = await pool.query(`
      INSERT INTO ${schema}.apollo_search_cache (
        search_key,
        results,
        tenant_id,
        user_id,
        hit_count,
        last_accessed_at,
        metadata,
        is_deleted
      ) VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, $5, $6)
      ON CONFLICT (search_key, tenant_id)
      DO UPDATE SET
        results = EXCLUDED.results,
        hit_count = ${schema}.apollo_search_cache.hit_count + 1,
        last_accessed_at = CURRENT_TIMESTAMP,
        metadata = EXCLUDED.metadata,
        is_deleted = EXCLUDED.is_deleted,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      searchKey,
      JSON.stringify(results),
      tenantId,
      userId,
      JSON.stringify(metadata),
      is_deleted
    ]);

    return result.rows[0];
  }

  /**
   * Find cached search by key and tenant
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  async findByKey(searchKey, tenantId, schema) {
    const result = await pool.query(`
      SELECT * FROM ${schema}.apollo_search_cache
      WHERE search_key = $1 
        AND tenant_id = $2
        AND is_deleted = false
        AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `, [searchKey, tenantId]);

    return result.rows[0] || null;
  }

  /**
   * Update cache hit count and last accessed time
   * LAD Architecture: SQL only, tenant-scoped update
   */
  async updateAccessStats(searchKey, tenantId, schema) {
    await pool.query(`
      UPDATE ${schema}.apollo_search_cache
      SET 
        hit_count = hit_count + 1,
        last_accessed_at = CURRENT_TIMESTAMP
      WHERE search_key = $1 AND tenant_id = $2
    `, [searchKey, tenantId]);
  }

  /**
   * Prune old cache entries
   * LAD Architecture: SQL only, uses dynamic schema
   */
  async pruneOldEntries(hoursOld, schema) {
    const result = await pool.query(`
      DELETE FROM ${schema}.apollo_search_cache
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${hoursOld} hours'
      RETURNING id
    `, []);

    return result.rowCount;
  }

  /**
   * Get cache statistics
   * LAD Architecture: SQL only, optional tenant scoping
   */
  async getStats(schema, tenantId = null) {
    let sql = `
      SELECT 
        COUNT(*) as total_entries,
        SUM(hit_count) as total_hits,
        AVG(hit_count) as avg_hits_per_entry,
        MAX(last_accessed_at) as most_recent_access
      FROM ${schema}.apollo_search_cache
      WHERE is_deleted = false
    `;
    const params = [];

    if (tenantId) {
      sql += ` AND tenant_id = $1`;
      params.push(tenantId);
    }

    const result = await pool.query(sql, params);
    return result.rows[0];
  }
}

module.exports = new ApolloSearchCacheRepository();

