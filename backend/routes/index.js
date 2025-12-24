/**
 * Campaign Routes
 * Express routes for campaign management and execution
 */

const express = require('express');
const router = express.Router();
const CampaignController = require('../controllers/CampaignController');
const linkedInRoutes = require('./linkedin');
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
const {
  validateCampaignCreation,
  validateCampaignUpdate,
  validateUuidParam,
  validatePagination,
  validateLeadIds
} = require('../middleware/validation');

// LinkedIn integration (mount before /:id routes to avoid conflicts)
router.use('/linkedin', linkedInRoutes);

// Campaign CRUD operations
router.get('/', jwtAuth, validatePagination, CampaignController.listCampaigns);
router.get('/stats', jwtAuth, CampaignController.getCampaignStats);
router.get('/:id', jwtAuth, validateUuidParam('id'), CampaignController.getCampaignById);
router.post('/', jwtAuth, validateCampaignCreation, CampaignController.createCampaign);
router.patch('/:id', jwtAuth, validateUuidParam('id'), validateCampaignUpdate, CampaignController.updateCampaign);
router.delete('/:id', jwtAuth, validateUuidParam('id'), CampaignController.deleteCampaign);

// Campaign leads
router.get('/:id/leads', jwtAuth, validateUuidParam('id'), validatePagination, CampaignController.getCampaignLeads);
router.post('/:id/leads', jwtAuth, validateUuidParam('id'), validateLeadIds, CampaignController.addLeadsToCampaign);

// Campaign activities
router.get('/:id/activities', jwtAuth, validateUuidParam('id'), validatePagination, CampaignController.getCampaignActivities);

// Campaign controls
router.post('/:id/start', jwtAuth, validateUuidParam('id'), CampaignController.startCampaign);
router.post('/:id/pause', jwtAuth, validateUuidParam('id'), CampaignController.pauseCampaign);
router.post('/:id/stop', jwtAuth, validateUuidParam('id'), CampaignController.stopCampaign);

// Campaign steps
router.get('/:id/steps', jwtAuth, validateUuidParam('id'), CampaignController.getCampaignSteps);
router.post('/:id/steps', jwtAuth, validateUuidParam('id'), CampaignController.updateCampaignSteps);

module.exports = router;
