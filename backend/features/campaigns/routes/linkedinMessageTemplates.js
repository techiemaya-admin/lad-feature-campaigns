/**
 * LinkedIn Message Templates Routes
 * API routes for message templates
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/LinkedInMessageTemplatesController');
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');

// All routes require authentication
router.use(jwtAuth);

/**
 * GET /api/campaigns/linkedin/message-templates
 * Get all templates for tenant
 * Query params: ?is_active=true&category=sales
 */
router.get('/', controller.getAll.bind(controller));

/**
 * GET /api/campaigns/linkedin/message-templates/default
 * Get default template for tenant
 * NOTE: Must be before /:id route to avoid conflict
 */
router.get('/default', controller.getDefault.bind(controller));

/**
 * GET /api/campaigns/linkedin/message-templates/:id
 * Get single template by ID
 */
router.get('/:id', controller.getById.bind(controller));

/**
 * POST /api/campaigns/linkedin/message-templates
 * Create new template
 * Body: { name, description, connection_message, followup_message, category, tags, is_default }
 */
router.post('/', controller.create.bind(controller));

/**
 * PUT /api/campaigns/linkedin/message-templates/:id
 * Update template
 * Body: { name?, description?, connection_message?, followup_message?, category?, tags?, is_default? }
 */
router.put('/:id', controller.update.bind(controller));

/**
 * DELETE /api/campaigns/linkedin/message-templates/:id
 * Delete template (soft delete)
 */
router.delete('/:id', controller.delete.bind(controller));

module.exports = router;
