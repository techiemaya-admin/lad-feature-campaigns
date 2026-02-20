/**
 * Membership Model
 * 
 * Junction entity for user-tenant relationships
 * Manages which users belong to which tenants and their roles
 * 
 * Table: memberships
 * Schema: Core infrastructure table
 * 
 * FUTURE ENHANCEMENTS:
 * 1. Permission-based access (RBAC) - membership_permissions table
 * 2. Invitation flow - tenant_invitations table with email/token/expiry
 * 3. Primary tenant consistency - sync with users.primary_organization_id
 * 4. Consider tenant_role ENUM type for strict role validation
 * 5. Consider one_owner_per_tenant constraint if single owner required
 */

class MembershipModel {
  // Role constants to avoid hardcoded strings
  static ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member',
    VIEWER: 'viewer'
  };

  constructor(db) {
    this.pool = db;
  }

  /**
   * Add user to tenant with a specific role
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @param {string} role - Role (e.g., 'owner', 'admin', 'member', 'viewer')
   * @returns {Promise<Object>} Created membership
   */
  async addUserToTenant(userId, tenantId, role = MembershipModel.ROLES.MEMBER) {
    const query = `
      INSERT INTO memberships (
        user_id,
        tenant_id,
        role,
        created_at
      ) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, tenant_id) 
      DO UPDATE SET 
        role = EXCLUDED.role,
        updated_at = NOW()
      RETURNING 
        id,
        user_id,
        tenant_id,
        role,
        created_at
    `;

    const values = [userId, tenantId, role];
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Remove user from tenant (soft delete)
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Success
   */
  async removeUserFromTenant(userId, tenantId) {
    const query = `
      UPDATE memberships
      SET deleted_at = NOW()
      WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Update user's role in a tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @param {string} newRole - New role
   * @returns {Promise<Object>} Updated membership
   */
  async updateUserRole(userId, tenantId, newRole) {
    const query = `
      UPDATE memberships
      SET role = $3, updated_at = NOW()
      WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      RETURNING 
        id,
        user_id,
        tenant_id,
        role,
        created_at,
        updated_at
    `;

    const result = await this.pool.query(query, [userId, tenantId, newRole]);
    return result.rows[0];
  }

  /**
   * Get user's role in a tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<string|null>} Role or null
   */
  async getUserRole(userId, tenantId) {
    const query = `
      SELECT role
      FROM memberships
      WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rows[0]?.role || null;
  }

  /**
   * Get membership details
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object|null>} Membership or null
   */
  async getMembership(userId, tenantId) {
    const query = `
      SELECT 
        m.id,
        m.user_id,
        m.tenant_id,
        m.role,
        m.created_at,
        u.email,
        u.first_name,
        u.last_name,
        t.name as tenant_name
      FROM memberships m
      INNER JOIN users u ON m.user_id = u.id
      INNER JOIN tenants t ON m.tenant_id = t.id
      WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Get all members of a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Query options
   * @param {string} options.role - Filter by role
   * @returns {Promise<Array>} Members
   */
  async getTenantMembers(tenantId, { role = null } = {}) {
    let query = `
      SELECT 
        m.id,
        m.user_id,
        m.role,
        m.created_at as joined_at,
        u.email,
        u.first_name,
        u.last_name,
        u.is_active
      FROM memberships m
      INNER JOIN users u ON m.user_id = u.id
      WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
    `;

    const values = [tenantId];

    if (role) {
      query += ` AND m.role = $2`;
      values.push(role);
    }

    query += ` ORDER BY m.created_at ASC`;

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get all tenants for a user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Tenant memberships
   */
  async getUserMemberships(userId) {
    const query = `
      SELECT 
        m.id,
        m.tenant_id,
        m.role,
        m.created_at as joined_at,
        t.name as tenant_name,
        t.is_active as tenant_is_active,
        p.name as plan_name
      FROM memberships m
      INNER JOIN tenants t ON m.tenant_id = t.id
      LEFT JOIN plans p ON t.plan_id = p.id
      WHERE m.user_id = $1 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Check if user is a member of tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Is member
   */
  async isMember(userId, tenantId) {
    const query = `
      SELECT 1
      FROM memberships
      WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1
    `;

    const result = await this.pool.query(query, [userId, tenantId]);
    return result.rowCount > 0;
  }

  /**
   * Check if user has specific role(s) in tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @param {string|Array<string>} roles - Role(s) to check
   * @returns {Promise<boolean>} Has role
   */
  async hasRole(userId, tenantId, roles) {
    const roleArray = Array.isArray(roles) ? roles : [roles];
    
    const query = `
      SELECT 1
      FROM memberships
      WHERE user_id = $1 
        AND tenant_id = $2 
        AND role = ANY($3)
        AND deleted_at IS NULL
      LIMIT 1
    `;

    const result = await this.pool.query(query, [userId, tenantId, roleArray]);
    return result.rowCount > 0;
  }

  /**
   * Check if user is owner/admin of tenant
   * 
   * @param {string} userId - User ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>} Is admin
   */
  async isAdmin(userId, tenantId) {
    return this.hasRole(userId, tenantId, [MembershipModel.ROLES.OWNER, MembershipModel.ROLES.ADMIN]);
  }

  /**
   * Get member count for a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<number>} Member count
   */
  async getMemberCount(tenantId) {
    const query = `
      SELECT COUNT(*) as count
      FROM memberships
      WHERE tenant_id = $1 AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [tenantId]);
    return parseInt(result.rows[0].count);
  }

  /**
   * Get members by role
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} role - Role to filter by
   * @returns {Promise<Array>} Members with specified role
   */
  async getMembersByRole(tenantId, role) {
    const query = `
      SELECT 
        m.user_id,
        u.email,
        u.first_name,
        u.last_name,
        m.created_at as joined_at
      FROM memberships m
      INNER JOIN users u ON m.user_id = u.id
      WHERE m.tenant_id = $1 AND m.role = $2 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
    `;

    const result = await this.pool.query(query, [tenantId, role]);
    return result.rows;
  }

  /**
   * Get tenant owners
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Array>} Owner users
   */
  async getTenantOwners(tenantId) {
    return this.getMembersByRole(tenantId, MembershipModel.ROLES.OWNER);
  }

  /**
   * Transfer ownership (make user owner, demote current owner)
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} currentOwnerId - Current owner user ID
   * @param {string} newOwnerId - New owner user ID
   * @returns {Promise<boolean>} Success
   */
  async transferOwnership(tenantId, currentOwnerId, newOwnerId) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Demote current owner to admin
      await client.query(
        'UPDATE memberships SET role = $1, updated_at = NOW() WHERE user_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
        [MembershipModel.ROLES.ADMIN, currentOwnerId, tenantId]
      );

      // Promote new owner
      await client.query(
        'UPDATE memberships SET role = $1, updated_at = NOW() WHERE user_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
        [MembershipModel.ROLES.OWNER, newOwnerId, tenantId]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch add users to tenant
   * 
   * @param {Array<Object>} memberships - Array of {userId, tenantId, role}
   * @returns {Promise<Array>} Created memberships
   */
  async batchAddMembers(memberships) {
    const values = [];
    const placeholders = [];
    
    memberships.forEach((m, idx) => {
      const offset = idx * 3;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      values.push(m.userId, m.tenantId, m.role || MembershipModel.ROLES.MEMBER);
    });

    const query = `
      INSERT INTO memberships (user_id, tenant_id, role, created_at)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (user_id, tenant_id) DO NOTHING
      RETURNING id, user_id, tenant_id, role, created_at
    `;

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get membership statistics for a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Statistics
   */
  async getTenantMembershipStats(tenantId) {
    const query = `
      SELECT 
        COUNT(*) as total_members,
        COUNT(CASE WHEN role = 'owner' THEN 1 END) as owners,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admins,
        COUNT(CASE WHEN role = 'member' THEN 1 END) as members,
        COUNT(CASE WHEN role = 'viewer' THEN 1 END) as viewers,
        MIN(created_at) as first_member_joined,
        MAX(created_at) as last_member_joined
      FROM memberships
      WHERE tenant_id = $1 AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows[0];
  }
}

module.exports = MembershipModel;
