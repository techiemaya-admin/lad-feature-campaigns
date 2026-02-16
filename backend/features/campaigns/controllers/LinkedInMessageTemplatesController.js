/**
 * LinkedIn Message Templates Controller
 * API endpoint handlers for message templates
 * 
 * LAD Architecture: Controller Layer
 * - Validate input
 * - Call service for business logic
 * - Return response
 * - NO SQL, NO business logic
 */

const logger = require('../../../core/utils/logger');
const service = require('../services/LinkedInMessageTemplatesService');

class LinkedInMessageTemplatesController {
  /**
   * GET /api/campaigns/linkedin/message-templates
   * Get all templates for tenant
   */
  async getAll(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }

      const filters = {
        isActive: req.query.is_active === 'true' ? true : req.query.is_active === 'false' ? false : undefined,
        category: req.query.category
      };

      const context = { schema: req.user?.schema };
      const templates = await service.getAllTemplates(tenantId, filters, context);

      res.json({ 
        success: true, 
        data: templates,
        count: templates.length
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error getting templates', {
        error: error.message
      });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get templates' 
      });
    }
  }

  /**
   * GET /api/campaigns/linkedin/message-templates/:id
   * Get single template by ID
   */
  async getById(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Template ID required' });
      }

      const context = { schema: req.user?.schema };
      const template = await service.getTemplate(id, tenantId, context);

      if (!template) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found' 
        });
      }

      res.json({ 
        success: true, 
        data: template 
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error getting template', {
        id: req.params.id,
        error: error.message
      });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get template' 
      });
    }
  }

  /**
   * GET /api/campaigns/linkedin/message-templates/default
   * Get default template for tenant
   */
  async getDefault(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }

      const context = { schema: req.user?.schema };
      const template = await service.getDefaultTemplate(tenantId, context);

      if (!template) {
        return res.status(404).json({ 
          success: false, 
          error: 'No default template found' 
        });
      }

      res.json({ 
        success: true, 
        data: template 
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error getting default template', {
        error: error.message
      });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get default template' 
      });
    }
  }

  /**
   * POST /api/campaigns/linkedin/message-templates
   * Create new template
   */
  async create(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      const userId = req.user?.id;
      
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }
      if (!userId) {
        return res.status(400).json({ error: 'User context required' });
      }

      const data = req.body;
      
      // Validate required fields
      if (!data.name) {
        return res.status(400).json({ error: 'Template name is required' });
      }

      const context = { schema: req.user?.schema };
      const template = await service.createTemplate(data, tenantId, userId, context);

      res.status(201).json({ 
        success: true, 
        data: template 
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error creating template', {
        error: error.message
      });
      
      if (error.message.includes('required') || error.message.includes('300 characters')) {
        return res.status(400).json({ 
          success: false, 
          error: error.message 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create template' 
      });
    }
  }

  /**
   * PUT /api/campaigns/linkedin/message-templates/:id
   * Update template
   */
  async update(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Template ID required' });
      }

      const data = req.body;
      const context = { schema: req.user?.schema };
      const template = await service.updateTemplate(id, data, tenantId, context);

      if (!template) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found' 
        });
      }

      res.json({ 
        success: true, 
        data: template 
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error updating template', {
        id: req.params.id,
        error: error.message
      });
      
      if (error.message.includes('300 characters')) {
        return res.status(400).json({ 
          success: false, 
          error: error.message 
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update template' 
      });
    }
  }

  /**
   * DELETE /api/campaigns/linkedin/message-templates/:id
   * Delete template (soft delete)
   */
  async delete(req, res) {
    try {
      const tenantId = req.user?.tenant_id;
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context required' });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Template ID required' });
      }

      const context = { schema: req.user?.schema };
      const success = await service.deleteTemplate(id, tenantId, context);

      if (!success) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found' 
        });
      }

      res.json({ 
        success: true, 
        message: 'Template deleted successfully' 
      });
    } catch (error) {
      logger.error('[LinkedInMessageTemplatesController] Error deleting template', {
        id: req.params.id,
        error: error.message
      });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete template' 
      });
    }
  }
}

module.exports = new LinkedInMessageTemplatesController();
