/**
 * LinkedIn Message Templates Repository
 * Data access layer for message templates
 * 
 * LAD Architecture: Repository Layer (SQL ONLY)
 * - All database queries
 * - NO business logic
 * - Tenant-scoped queries only
 * 
 * Uses communication_templates table with:
 * - channel = 'linkedin'
 * - category = 'linkedin_connection' (for connection messages)
 * - category = 'linkedin_followup' (for followup messages)
 * - template_key links connection and followup messages together
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class LinkedInMessageTemplatesRepository {
  /**
   * Get all templates for tenant (grouped by template_key)
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} filters - Optional filters { isActive, category }
   * @param {Object} context - Request context
   * @returns {Promise<Array>} Templates with connection_message and followup_message
   */
  async getAllForTenant(tenantId, filters = {}, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    const { isActive } = filters;
    
    // Fetch connection templates (these are the primary records)
    let query = `
      SELECT 
        id, tenant_id, name, description, template_key,
        content as connection_message,
        category, tags, is_default, is_active,
        usage_count, last_used_at,
        metadata, created_by, created_at, updated_at
      FROM ${schema}.communication_templates
      WHERE tenant_id = $1 
        AND channel = 'linkedin' 
        AND category = 'linkedin_connection'
        AND is_deleted = false
    `;
    
    const params = [tenantId];
    let paramIndex = 2;
    
    if (isActive !== undefined) {   
      query += ` AND is_active = $${paramIndex}`;
      params.push(isActive);
      paramIndex++;
    }
    
    query += ` ORDER BY is_default DESC, name ASC`;
    
    const connectionTemplates = await pool.query(query, params);
    
    // For each connection template, fetch the corresponding followup message
    const templates = await Promise.all(
      connectionTemplates.rows.map(async (template) => {
        // Fetch followup message if exists
        const followupQuery = `
          SELECT content as followup_message, id as followup_id
          FROM ${schema}.communication_templates
          WHERE tenant_id = $1 
            AND channel = 'linkedin'
            AND category = 'linkedin_followup'
            AND template_key = $2
            AND is_deleted = false
          LIMIT 1
        `;
        const followupResult = await pool.query(followupQuery, [tenantId, template.template_key]);
        
        return {
          ...template,
          followup_message: followupResult.rows.length > 0 ? followupResult.rows[0].followup_message : null,
          followup_id: followupResult.rows.length > 0 ? followupResult.rows[0].followup_id : null
        };
      })
    );
    
    return templates;
  }

  /**
   * Get template by ID (tenant-isolated)
   * Fetches both connection and followup messages
   * @param {string} id - Connection template ID or followup ID
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Template with connection and followup messages or null
   */
  async getById(id, tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    
    // First, fetch the record by ID to get the template_key
    const query = `
      SELECT 
        id, tenant_id, name, description, template_key, category,
        content, tags, is_default, is_active,
        usage_count, last_used_at,
        metadata, created_by, created_at, updated_at
      FROM ${schema}.communication_templates
      WHERE id = $1 AND tenant_id = $2 AND channel = 'linkedin' AND is_deleted = false
    `;
    
    const result = await pool.query(query, [id, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    
    const record = result.rows[0];
    const templateKey = record.template_key;
    
    // Fetch both connection and followup messages using template_key
    const bothQuery = `
      SELECT 
        id, category, content,
        name, description, tags, is_default, is_active,
        usage_count, last_used_at,
        metadata, created_by, created_at, updated_at
      FROM ${schema}.communication_templates
      WHERE tenant_id = $1 
        AND channel = 'linkedin'
        AND template_key = $2
        AND is_deleted = false
    `;
    
    const bothResult = await pool.query(bothQuery, [tenantId, templateKey]);
    
    // Combine into single object
    const template = {
      id: null,
      tenant_id: tenantId,
      template_key: templateKey,
      name: null,
      description: null,
      connection_message: null,
      followup_message: null,
      category: null,
      tags: null,
      is_default: false,
      is_active: true,
      usage_count: 0,
      last_used_at: null,
      metadata: {},
      created_by: null,
      created_at: null,
      updated_at: null,
      followup_id: null
    };
    
    bothResult.rows.forEach(row => {
      if (row.category === 'linkedin_connection') {
        template.id = row.id;
        template.name = row.name;
        template.description = row.description;
        template.connection_message = row.content;
        template.tags = row.tags;
        template.is_default = row.is_default;
        template.is_active = row.is_active;
        template.usage_count = row.usage_count;
        template.last_used_at = row.last_used_at;
        template.metadata = row.metadata;
        template.created_by = row.created_by;
        template.created_at = row.created_at;
        template.updated_at = row.updated_at;
      } else if (row.category === 'linkedin_followup') {
        template.followup_message = row.content;
        template.followup_id = row.id;
      }
    });
    
    return template.id ? template : null;
  }

  /**
   * Get default template for tenant
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Default template with connection and followup messages or null
   */
  async getDefault(tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    
    // Find the default connection template
    const query = `
      SELECT 
        id, tenant_id, name, description, template_key,
        content as connection_message,
        category, tags, is_default, is_active,
        usage_count, last_used_at,
        metadata, created_by, created_at, updated_at
      FROM ${schema}.communication_templates
      WHERE tenant_id = $1 
        AND channel = 'linkedin' 
        AND category = 'linkedin_connection'
        AND is_default = true 
        AND is_deleted = false
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    
    const template = result.rows[0];
    
    // Fetch corresponding followup message if exists
    const followupQuery = `
      SELECT content as followup_message, id as followup_id
      FROM ${schema}.communication_templates
      WHERE tenant_id = $1 
        AND channel = 'linkedin'
        AND category = 'linkedin_followup'
        AND template_key = $2
        AND is_deleted = false
      LIMIT 1
    `;
    const followupResult = await pool.query(followupQuery, [tenantId, template.template_key]);
    
    template.followup_message = followupResult.rows.length > 0 ? followupResult.rows[0].followup_message : null;
    template.followup_id = followupResult.rows.length > 0 ? followupResult.rows[0].followup_id : null;
    
    return template;
  }

  /**
   * Create new template (creates both connection and followup records if provided)
   * @param {Object} data - Template data { name, description, connection_message, followup_message, tags, is_default, is_active, metadata }
   * @param {string} tenantId - Tenant ID (required)
   * @param {string} userId - User ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Created template with both messages
   */
  async create(data, tenantId, userId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Generate a unique template_key to link connection and followup messages
      const templateKey = `linkedin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // If setting as default, unset other defaults for this tenant+channel+category
      if (data.is_default) {
        await client.query(
          `UPDATE ${schema}.communication_templates 
           SET is_default = false, updated_at = NOW()
           WHERE tenant_id = $1 
             AND channel = 'linkedin' 
             AND category = 'linkedin_connection'
             AND is_default = true 
             AND is_deleted = false`,
          [tenantId]
        );
      }
      
      // Insert connection message template (primary record)
      const connectionQuery = `
        INSERT INTO ${schema}.communication_templates (
          tenant_id, name, description, channel, category, template_key,
          content, tags, is_default, is_active,
          metadata, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, 'linkedin', 'linkedin_connection', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING 
          id, tenant_id, name, description, template_key,
          content as connection_message,
          category, tags, is_default, is_active,
          usage_count, last_used_at,
          metadata, created_by, created_at, updated_at
      `;
      
      const connectionValues = [
        tenantId,
        data.name,
        data.description || null,
        templateKey,
        data.connection_message || null,
        data.tags || [],
        data.is_default || false,
        data.is_active !== undefined ? data.is_active : true,
        data.metadata || {},
        userId
      ];
      
      const connectionResult = await client.query(connectionQuery, connectionValues);
      const template = connectionResult.rows[0];
      
      // Insert followup message template if provided
      let followupId = null;
      if (data.followup_message) {
        const followupQuery = `
          INSERT INTO ${schema}.communication_templates (
            tenant_id, name, description, channel, category, template_key,
            content, tags, is_active,
            metadata, created_by, created_at, updated_at
          ) VALUES ($1, $2, $3, 'linkedin', 'linkedin_followup', $4, $5, $6, $7, $8, $9, NOW(), NOW())
          RETURNING id
        `;
        
        const followupValues = [
          tenantId,
          data.name + ' (Followup)',
          data.description || null,
          templateKey,
          data.followup_message,
          data.tags || [],
          data.is_active !== undefined ? data.is_active : true,
          data.metadata || {},
          userId
        ];
        
        const followupResult = await client.query(followupQuery, followupValues);
        followupId = followupResult.rows[0].id;
      }
      
      await client.query('COMMIT');
      
      return {
        ...template,
        followup_message: data.followup_message || null,
        followup_id: followupId
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update template (updates connection and/or followup records)
   * @param {string} id - Connection template ID
   * @param {Object} data - Update data
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Updated template with both messages or null
   */
  async update(id, data, tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the template_key for this ID
      const keyQuery = `
        SELECT template_key, category FROM ${schema}.communication_templates
        WHERE id = $1 AND tenant_id = $2 AND channel = 'linkedin' AND is_deleted = false
      `;
      const keyResult = await client.query(keyQuery, [id, tenantId]);
      
      if (keyResult.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }
      
      const templateKey = keyResult.rows[0].template_key;
      const isConnectionRecord = keyResult.rows[0].category === 'linkedin_connection';
      
      // If setting as default, unset other defaults for this tenant+channel+category
      if (data.is_default && isConnectionRecord) {
        await client.query(
          `UPDATE ${schema}.communication_templates 
           SET is_default = false, updated_at = NOW()
           WHERE tenant_id = $1 
             AND channel = 'linkedin' 
             AND category = 'linkedin_connection'
             AND id != $2 
             AND is_default = true 
             AND is_deleted = false`,
          [tenantId, id]
        );
      }
      
      // Update connection template if it's a connection record or if connection_message is provided
      if (isConnectionRecord) {
        const connectionUpdates = [];
        const connectionValues = [];
        let paramIndex = 1;
        
        const connectionFields = ['name', 'description', 'tags', 'is_default', 'is_active', 'metadata'];
        
        connectionFields.forEach(field => {
          if (data[field] !== undefined) {
            connectionUpdates.push(`${field} = $${paramIndex}`);
            connectionValues.push(data[field]);
            paramIndex++;
          }
        });
        
        // Map connection_message to content field
        if (data.connection_message !== undefined) {
          connectionUpdates.push(`content = $${paramIndex}`);
          connectionValues.push(data.connection_message);
          paramIndex++;
        }
        
        if (connectionUpdates.length > 0) {
          connectionUpdates.push(`updated_at = NOW()`);
          connectionValues.push(id, tenantId);
          
          const connectionQuery = `
            UPDATE ${schema}.communication_templates
            SET ${connectionUpdates.join(', ')}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} AND channel = 'linkedin' AND is_deleted = false
          `;
          
          await client.query(connectionQuery, connectionValues);
        }
      }
      
      // Update or create followup template
      if (data.followup_message !== undefined) {
        // Check if followup exists
        const followupCheckQuery = `
          SELECT id FROM ${schema}.communication_templates
          WHERE tenant_id = $1 
            AND channel = 'linkedin'
            AND category = 'linkedin_followup'
            AND template_key = $2
            AND is_deleted = false
        `;
        const followupCheck = await client.query(followupCheckQuery, [tenantId, templateKey]);
        
        if (data.followup_message === null || data.followup_message === '') {
          // Delete followup if set to null/empty
          if (followupCheck.rows.length > 0) {
            await client.query(
              `UPDATE ${schema}.communication_templates
               SET is_deleted = true, updated_at = NOW()
               WHERE id = $1 AND tenant_id = $2`,
              [followupCheck.rows[0].id, tenantId]
            );
          }
        } else if (followupCheck.rows.length > 0) {
          // Update existing followup
          await client.query(
            `UPDATE ${schema}.communication_templates
             SET content = $1, updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3`,
            [data.followup_message, followupCheck.rows[0].id, tenantId]
          );
        } else {
          // Create new followup - get info from connection record
          const connectionQuery = `
            SELECT name, description, tags, is_active, metadata, created_by 
            FROM ${schema}.communication_templates
            WHERE template_key = $1 AND tenant_id = $2 AND channel = 'linkedin' 
              AND category = 'linkedin_connection' AND is_deleted = false
          `;
          const connectionInfo = await client.query(connectionQuery, [templateKey, tenantId]);
          
          if (connectionInfo.rows.length > 0) {
            const conn = connectionInfo.rows[0];
            await client.query(
              `INSERT INTO ${schema}.communication_templates (
                tenant_id, name, description, channel, category, template_key,
                content, tags, is_active, metadata, created_by, created_at, updated_at
              ) VALUES ($1, $2, $3, 'linkedin', 'linkedin_followup', $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
              [
                tenantId,
                conn.name + ' (Followup)',
                conn.description,
                templateKey,
                data.followup_message,
                conn.tags,
                conn.is_active,
                conn.metadata,
                conn.created_by
              ]
            );
          }
        }
      }
      
      await client.query('COMMIT');
      
      // Get the connection record ID if we were updating a followup record
      let connectionId = isConnectionRecord ? id : null;
      if (!connectionId) {
        const connIdQuery = `
          SELECT id FROM ${schema}.communication_templates
          WHERE template_key = $1 AND tenant_id = $2 
            AND channel = 'linkedin' AND category = 'linkedin_connection' 
            AND is_deleted = false
        `;
        const connIdResult = await client.query(connIdQuery, [templateKey, tenantId]);
        if (connIdResult.rows.length > 0) {
          connectionId = connIdResult.rows[0].id;
        }
      }
      
      // Return the updated template
      return connectionId ? await this.getById(connectionId, tenantId, context) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete template (soft delete both connection and followup records)
   * @param {string} id - Connection template ID
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} Success
   */
  async delete(id, tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the template_key for this ID
      const keyQuery = `
        SELECT template_key FROM ${schema}.communication_templates
        WHERE id = $1 AND tenant_id = $2 AND channel = 'linkedin' AND is_deleted = false
      `;
      const keyResult = await client.query(keyQuery, [id, tenantId]);
      
      if (keyResult.rows.length === 0) {
        await client.query('COMMIT');
        return false;
      }
      
      const templateKey = keyResult.rows[0].template_key;
      
      // Soft delete all records (connection and followup) with this template_key
      const query = `
        UPDATE ${schema}.communication_templates
        SET is_deleted = true, updated_at = NOW()
        WHERE tenant_id = $1 AND channel = 'linkedin' AND template_key = $2 AND is_deleted = false
      `;
      
      const result = await client.query(query, [tenantId, templateKey]);
      await client.query('COMMIT');
      
      return result.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Increment usage count for a specific template record
   * @param {string} id - Template ID (can be connection or followup ID)
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<void>}
   */
  async incrementUsage(id, tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[Repository] tenantId is required - all queries must be tenant-scoped');
    }
    
    const schema = getSchema(context);
    
    const query = `
      UPDATE ${schema}.communication_templates
      SET 
        usage_count = usage_count + 1,
        last_used_at = NOW(),
        updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND channel = 'linkedin' AND is_deleted = false
    `;
    
    await pool.query(query, [id, tenantId]);
  }
}

module.exports = new LinkedInMessageTemplatesRepository();
