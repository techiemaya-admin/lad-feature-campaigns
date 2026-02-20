/**
 * Tenant Model
 * 
 * Core entity for multi-tenancy
 * Represents organizations/companies using the platform
 * 
 * Table: tenants
 * Schema: Core infrastructure table
 */

class TenantModel {
  constructor(db) {
    this.pool = db;
  }

  /**
   * Get tenant by ID
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object|null>} Tenant or null
   */
  async getTenantById(tenantId) {
    const query = `
      SELECT 
        id,
        name,
        plan_id,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM tenants
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Get tenant by name
   * 
   * @param {string} name - Tenant name
   * @returns {Promise<Object|null>} Tenant or null
   */
  async getTenantByName(name) {
    const query = `
      SELECT 
        id,
        name,
        plan_id,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM tenants
      WHERE LOWER(name) = LOWER($1)
    `;

    const result = await this.pool.query(query, [name]);
    return result.rows[0] || null;
  }

  /**
   * Get all active tenants
   * 
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array>} Tenants
   */
  async getAllTenants({ limit = 50, offset = 0 } = {}) {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.plan_id,
        p.name as plan_name,
        t.is_active,
        t.created_at,
        (SELECT COUNT(*) FROM memberships WHERE tenant_id = t.id) as member_count
      FROM tenants t
      LEFT JOIN plans p ON t.plan_id = p.id
      WHERE t.is_active = true
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Create a new tenant
   * 
   * @param {Object} params - Tenant parameters
   * @param {string} params.name - Tenant name
   * @param {string} params.planId - Plan ID (optional)
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Created tenant
   */
  async createTenant({ name, planId = null, metadata = {} }) {
    const query = `
      INSERT INTO tenants (
        name,
        plan_id,
        is_active,
        metadata,
        created_at,
        updated_at
      ) VALUES ($1, $2, true, $3, NOW(), NOW())
      RETURNING 
        id,
        name,
        plan_id,
        is_active,
        metadata,
        created_at
    `;

    const values = [name, planId, JSON.stringify(metadata)];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated tenant
   */
  async updateTenant(tenantId, updates) {
    const setClauses = ['updated_at = NOW()'];
    const values = [tenantId];
    let paramIndex = 2;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      values.push(updates.name);
      paramIndex++;
    }
    if (updates.planId !== undefined) {
      setClauses.push(`plan_id = $${paramIndex}`);
      values.push(updates.planId);
      paramIndex++;
    }
    if (updates.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex}`);
      values.push(updates.isActive);
      paramIndex++;
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex}`);
      values.push(JSON.stringify(updates.metadata));
      paramIndex++;
    }

    const query = `
      UPDATE tenants
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING 
        id,
        name,
        plan_id,
        is_active,
        metadata,
        updated_at
    `;

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Deactivate tenant (soft delete)
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Success
   */
  async deactivateTenant(tenantId) {
    const query = `
      UPDATE tenants
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Activate tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Success
   */
  async activateTenant(tenantId) {
    const query = `
      UPDATE tenants
      SET is_active = true, updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Get tenant users (via memberships)
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Array>} Users with roles
   */
  async getTenantUsers(tenantId) {
    const query = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        m.role,
        m.created_at as joined_at
      FROM users u
      INNER JOIN memberships m ON u.id = m.user_id
      WHERE m.tenant_id = $1
      ORDER BY m.created_at ASC
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows;
  }

  /**
   * Get tenant features (combined plan + overrides)
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Array>} Enabled features
   */
  async getTenantFeatures(tenantId) {
    const query = `
      SELECT 
        f.id,
        f.feature_key,
        f.name,
        f.description,
        COALESCE(tf.feature_value, pf.feature_value, f.default_value) as feature_value,
        CASE 
          WHEN tf.id IS NOT NULL THEN 'tenant_override'
          WHEN pf.id IS NOT NULL THEN 'plan'
          ELSE 'default'
        END as source
      FROM features f
      LEFT JOIN tenants t ON t.id = $1
      LEFT JOIN plan_features pf ON pf.plan_id = t.plan_id AND pf.feature_id = f.id
      LEFT JOIN tenant_features tf ON tf.tenant_id = t.id AND tf.feature_id = f.id
      WHERE (pf.id IS NOT NULL OR tf.id IS NOT NULL)
      ORDER BY f.feature_key
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows;
  }

  /**
   * Check if a feature is enabled for tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} featureKey - Feature key
   * @returns {Promise<Object|null>} Feature value or null
   */
  async isFeatureEnabled(tenantId, featureKey) {
    const query = `
      SELECT 
        f.feature_key,
        COALESCE(
          tf.feature_value,
          pf.feature_value,
          f.default_value
        ) as feature_value
      FROM features f
      LEFT JOIN tenants t ON t.id = $1
      LEFT JOIN plan_features pf ON pf.plan_id = t.plan_id AND pf.feature_id = f.id
      LEFT JOIN tenant_features tf ON tf.tenant_id = t.id AND tf.feature_id = f.id
      WHERE f.feature_key = $2
      LIMIT 1
    `;

    const result = await this.pool.query(query, [tenantId, featureKey]);
    return result.rows[0] || null;
  }

  /**
   * Get tenant statistics
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Statistics
   */
  async getTenantStats(tenantId) {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM memberships WHERE tenant_id = $1) as member_count,
        (SELECT COUNT(*) FROM voice_agents WHERE tenant_id = $1 AND is_active = true) as agent_count,
        (SELECT COUNT(*) FROM voice_calls WHERE tenant_id = $1) as total_calls,
        (SELECT COUNT(*) FROM voice_calls WHERE tenant_id = $1 AND started_at > NOW() - INTERVAL '30 days') as calls_last_30_days,
        (SELECT COUNT(*) FROM leads WHERE tenant_id = $1) as lead_count
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows[0];
  }

  /**
   * Get tenant with plan details
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object|null>} Tenant with plan
   */
  async getTenantWithPlan(tenantId) {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.is_active,
        t.metadata,
        t.created_at,
        t.updated_at,
        p.id as plan_id,
        p.name as plan_name,
        p.price as plan_price,
        p.billing_cycle as plan_billing_cycle
      FROM tenants t
      LEFT JOIN plans p ON t.plan_id = p.id
      WHERE t.id = $1
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Search tenants by name
   * 
   * @param {string} searchTerm - Search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Matching tenants
   */
  async searchTenants(searchTerm, limit = 10) {
    const query = `
      SELECT 
        id,
        name,
        plan_id,
        is_active,
        created_at
      FROM tenants
      WHERE name ILIKE $1
      ORDER BY 
        CASE WHEN LOWER(name) = LOWER($2) THEN 0 ELSE 1 END,
        name ASC
      LIMIT $3
    `;

    const result = await this.pool.query(query, [`%${searchTerm}%`, searchTerm, limit]);
    return result.rows;
  }
}

module.exports = TenantModel;
