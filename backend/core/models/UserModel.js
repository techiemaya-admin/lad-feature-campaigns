/**
 * User Model
 * 
 * Core entity for user management
 * Represents individual users across all tenants
 * 
 * Table: users
 * Schema: Core infrastructure table
 */

class UserModel {
  constructor(db) {
    this.pool = db;
  }

  /**
   * Get user by ID
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User or null
   */
  async getUserById(userId) {
    const query = `
      SELECT 
        id,
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Get user by email
   * 
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User or null
   */
  async getUserByEmail(email) {
    const query = `
      SELECT 
        id,
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
    `;

    const result = await this.pool.query(query, [email]);
    return result.rows[0] || null;
  }

  /**
   * Get user by external ID (e.g., Clerk user_id)
   * 
   * @param {string} externalId - External user ID
   * @param {string} provider - Provider name (e.g., 'clerk', 'auth0')
   * @returns {Promise<Object|null>} User or null
   */
  async getUserByExternalId(externalId, provider = 'clerk') {
    const query = `
      SELECT 
        id,
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        created_at,
        updated_at
      FROM users
      WHERE metadata->>'external_id' = $1 
        AND metadata->>'provider' = $2
    `;

    const result = await this.pool.query(query, [externalId, provider]);
    return result.rows[0] || null;
  }

  /**
   * Create a new user
   * 
   * @param {Object} params - User parameters
   * @param {string} params.email - User email
   * @param {string} params.firstName - First name
   * @param {string} params.lastName - Last name
   * @param {string} params.externalId - External ID (e.g., Clerk user_id)
   * @param {string} params.provider - Auth provider
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Created user
   */
  async createUser({
    email,
    firstName = null,
    lastName = null,
    externalId = null,
    provider = 'clerk',
    metadata = {}
  }) {
    // Add external_id and provider to metadata if provided
    if (externalId) {
      metadata.external_id = externalId;
      metadata.provider = provider;
    }

    const query = `
      INSERT INTO users (
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, true, $4, NOW(), NOW())
      RETURNING 
        id,
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        created_at
    `;

    const values = [email, firstName, lastName, JSON.stringify(metadata)];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update user
   * 
   * @param {string} userId - User ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated user
   */
  async updateUser(userId, updates) {
    const setClauses = ['updated_at = NOW()'];
    const values = [userId];
    let paramIndex = 2;

    if (updates.email !== undefined) {
      setClauses.push(`email = $${paramIndex}`);
      values.push(updates.email);
      paramIndex++;
    }
    if (updates.firstName !== undefined) {
      setClauses.push(`first_name = $${paramIndex}`);
      values.push(updates.firstName);
      paramIndex++;
    }
    if (updates.lastName !== undefined) {
      setClauses.push(`last_name = $${paramIndex}`);
      values.push(updates.lastName);
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
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING 
        id,
        email,
        first_name,
        last_name,
        is_active,
        metadata,
        updated_at
    `;

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Deactivate user (soft delete)
   * 
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async deactivateUser(userId) {
    const query = `
      UPDATE users
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rowCount > 0;
  }

  /**
   * Activate user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async activateUser(userId) {
    const query = `
      UPDATE users
      SET is_active = true, updated_at = NOW()
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rowCount > 0;
  }

  /**
   * Get user's tenants (via memberships)
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Tenants with roles
   */
  async getUserTenants(userId) {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.is_active,
        m.role,
        m.created_at as joined_at,
        p.name as plan_name
      FROM tenants t
      INNER JOIN memberships m ON t.id = m.tenant_id
      LEFT JOIN plans p ON t.plan_id = p.id
      WHERE m.user_id = $1
      ORDER BY m.created_at ASC
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Get user's role in a specific tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<string|null>} Role or null
   */
  async getUserRoleInTenant(userId, tenantId) {
    const query = `
      SELECT role
      FROM memberships
      WHERE user_id = $1 AND tenant_id = $2
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rows[0]?.role || null;
  }

  /**
   * Check if user has access to a tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Has access
   */
  async hasAccessToTenant(userId, tenantId) {
    const query = `
      SELECT 1
      FROM memberships
      WHERE user_id = $1 AND tenant_id = $2
      LIMIT 1
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Check if user has specific role in tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @param {string|Array<string>} roles - Role(s) to check
   * @returns {Promise<boolean>} Has role
   */
  async hasRoleInTenant(userId, tenantId, roles) {
    const roleArray = Array.isArray(roles) ? roles : [roles];
    
    const query = `
      SELECT 1
      FROM memberships
      WHERE user_id = $1 
        AND tenant_id = $2 
        AND role = ANY($3)
      LIMIT 1
    `;

    const result = await this.pool.query(query, [userId, tenantId, roleArray]);
    return result.rowCount > 0;
  }

  /**
   * Get user with their primary tenant
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User with primary tenant
   */
  async getUserWithPrimaryTenant(userId) {
    const query = `
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.is_active,
        u.metadata,
        t.id as tenant_id,
        t.name as tenant_name,
        m.role as tenant_role
      FROM users u
      LEFT JOIN LATERAL (
        SELECT tenant_id, role, created_at
        FROM memberships
        WHERE user_id = u.id
        ORDER BY created_at ASC
        LIMIT 1
      ) m ON true
      LEFT JOIN tenants t ON m.tenant_id = t.id
      WHERE u.id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Search users by email or name
   * 
   * @param {string} searchTerm - Search term
   * @param {string} tenantId - Optional tenant filter
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Matching users
   */
  async searchUsers(searchTerm, tenantId = null, limit = 10) {
    let query;
    let values;

    if (tenantId) {
      // Search within a specific tenant
      query = `
        SELECT DISTINCT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          m.role,
          u.is_active
        FROM users u
        INNER JOIN memberships m ON u.id = m.user_id
        WHERE m.tenant_id = $1
          AND (
            u.email ILIKE $2
            OR u.first_name ILIKE $2
            OR u.last_name ILIKE $2
            OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $2
          )
        ORDER BY 
          CASE WHEN LOWER(u.email) = LOWER($3) THEN 0 ELSE 1 END,
          u.email ASC
        LIMIT $4
      `;
      values = [tenantId, `%${searchTerm}%`, searchTerm, limit];
    } else {
      // Global search
      query = `
        SELECT 
          id,
          email,
          first_name,
          last_name,
          is_active
        FROM users
        WHERE 
          email ILIKE $1
          OR first_name ILIKE $1
          OR last_name ILIKE $1
          OR CONCAT(first_name, ' ', last_name) ILIKE $1
        ORDER BY 
          CASE WHEN LOWER(email) = LOWER($2) THEN 0 ELSE 1 END,
          email ASC
        LIMIT $3
      `;
      values = [`%${searchTerm}%`, searchTerm, limit];
    }

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get user statistics
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Statistics
   */
  async getUserStats(userId) {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM memberships WHERE user_id = $1) as tenant_count,
        (SELECT COUNT(*) FROM voice_calls WHERE initiated_by = $1) as total_calls_initiated,
        u.created_at as account_created
      FROM users u
      WHERE u.id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows[0] || null;
  }
}

module.exports = UserModel;
