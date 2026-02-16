/**
 * LinkedIn Message Templates Service
 * Business logic for message templates
 * 
 * LAD Architecture: Service Layer (NO SQL)
 * - Business logic only
 * - Calls repository for data access
 * - NO direct database queries
 */

const logger = require('../../../core/utils/logger');
const repository = require('../repositories/LinkedInMessageTemplatesRepository');

class LinkedInMessageTemplatesService {
  /**
   * Get all templates for tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} filters - Optional filters
   * @param {Object} context - Request context
   * @returns {Promise<Array>} Templates
   */
  async getAllTemplates(tenantId, filters = {}, context = {}) {
    try {
      return await repository.getAllForTenant(tenantId, filters, context);
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error getting templates', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get template by ID
   * @param {string} id - Template ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Template or null
   */
  async getTemplate(id, tenantId, context = {}) {
    try {
      return await repository.getById(id, tenantId, context);
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error getting template', {
        id,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get default template for tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Default template or null
   */
  async getDefaultTemplate(tenantId, context = {}) {
    try {
      return await repository.getDefault(tenantId, context);
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error getting default template', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create new template
   * @param {Object} data - Template data
   * @param {string} tenantId - Tenant ID
   * @param {string} userId - User ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Created template
   */
  async createTemplate(data, tenantId, userId, context = {}) {
    try {
      // Business validation
      if (!data.name || data.name.trim().length === 0) {
        throw new Error('Template name is required');
      }

      if (!data.connection_message && !data.followup_message) {
        throw new Error('At least one message (connection or followup) is required');
      }

      // Validate LinkedIn connection message length (300 char limit)
      if (data.connection_message && data.connection_message.length > 300) {
        throw new Error('Connection message must be 300 characters or less (LinkedIn limit)');
      }

      const template = await repository.create(data, tenantId, userId, context);
      
      logger.info('[LinkedInMessageTemplatesService] Template created', {
        templateId: template.id,
        tenantId,
        userId,
        name: template.name
      });

      return template;
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error creating template', {
        tenantId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update template
   * @param {string} id - Template ID
   * @param {Object} data - Update data
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Updated template or null
   */
  async updateTemplate(id, data, tenantId, context = {}) {
    try {
      // Validate LinkedIn connection message length if being updated
      if (data.connection_message && data.connection_message.length > 300) {
        throw new Error('Connection message must be 300 characters or less (LinkedIn limit)');
      }

      const template = await repository.update(id, data, tenantId, context);
      
      if (template) {
        logger.info('[LinkedInMessageTemplatesService] Template updated', {
          templateId: template.id,
          tenantId,
          name: template.name
        });
      }

      return template;
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error updating template', {
        id,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete template
   * @param {string} id - Template ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} Success
   */
  async deleteTemplate(id, tenantId, context = {}) {
    try {
      const success = await repository.delete(id, tenantId, context);
      
      if (success) {
        logger.info('[LinkedInMessageTemplatesService] Template deleted', {
          templateId: id,
          tenantId
        });
      }

      return success;
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesService] Error deleting template', {
        id,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Track template usage
   * @param {string} id - Template ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<void>}
   */
  async trackUsage(id, tenantId, context = {}) {
    try {
      await repository.incrementUsage(id, tenantId, context);
      
      logger.debug('[LinkedInMessageTemplatesService] Template usage tracked', {
        templateId: id,
        tenantId
      });
    } catch (error) {
      // Non-critical - don't throw
      logger.warn('[LinkedInMessageTemplatesService] Error tracking usage', {
        id,
        tenantId,
        error: error.message
      });
    }
  }
}

module.exports = new LinkedInMessageTemplatesService();
