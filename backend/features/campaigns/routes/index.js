/**
 * Campaign Routes
 * Express routes for campaign management and execution
 */
const express = require('express');
const router = express.Router();
const CampaignController = require('../controllers/CampaignController');
const CampaignLeadsSummaryController = require('../controllers/CampaignLeadsSummaryController');
const CampaignLeadsRevealController = require('../controllers/CampaignLeadsRevealController');
const CampaignStatsController = require('../controllers/campaignStatsController');
const CampaignAnalyticsController = require('../controllers/campaignAnalyticsController');
const CampaignsStreamController = require('../controllers/campaignsStreamController');
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
// Real-time campaigns stream (SSE)
router.get('/stream', jwtAuth, CampaignsStreamController.streamAllCampaigns);
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
router.get('/:id/leads/:leadId/summary', jwtAuth, validateUuidParam('id'), validateUuidParam('leadId'), CampaignLeadsSummaryController.getLeadSummary);
router.post('/:id/leads/:leadId/summary', jwtAuth, validateUuidParam('id'), validateUuidParam('leadId'), CampaignLeadsSummaryController.generateLeadSummary);
router.post('/:id/leads/:leadId/reveal-email', jwtAuth, validateUuidParam('id'), validateUuidParam('leadId'), CampaignLeadsRevealController.revealLeadEmail);
router.post('/:id/leads/:leadId/reveal-phone', jwtAuth, validateUuidParam('id'), validateUuidParam('leadId'), CampaignLeadsRevealController.revealLeadPhone);
// Campaign analytics (new campaign_analytics table)
router.get('/:id/analytics', jwtAuth, validateUuidParam('id'), CampaignAnalyticsController.getCampaignAnalytics);
router.get('/:id/analytics/summary', jwtAuth, validateUuidParam('id'), CampaignAnalyticsController.getCampaignAnalyticsSummary);
// Campaign stats (SSE and REST)
router.get('/:id/events', jwtAuth, validateUuidParam('id'), CampaignStatsController.streamCampaignStats);
router.get('/:id/stats', jwtAuth, validateUuidParam('id'), CampaignStatsController.getCampaignStats);
router.post('/:id/stats/refresh', jwtAuth, validateUuidParam('id'), CampaignStatsController.refreshCampaignStats);
// Campaign activities (legacy route - keeping for backward compatibility)
router.get('/:id/activities', jwtAuth, validateUuidParam('id'), validatePagination, CampaignController.getCampaignActivities);
// Campaign controls
router.post('/:id/start', jwtAuth, validateUuidParam('id'), CampaignController.startCampaign);
router.post('/:id/pause', jwtAuth, validateUuidParam('id'), CampaignController.pauseCampaign);
router.post('/:id/stop', jwtAuth, validateUuidParam('id'), CampaignController.stopCampaign);
// Campaign steps
router.get('/:id/steps', jwtAuth, validateUuidParam('id'), CampaignController.getCampaignSteps);
router.post('/:id/steps', jwtAuth, validateUuidParam('id'), CampaignController.updateCampaignSteps);
module.exports = router;