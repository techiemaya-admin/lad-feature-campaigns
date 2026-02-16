/**
 * Unipile Search Routes
 */

const express = require('express');
const router = express.Router();
const UnipileSearchController = require('../controllers/UnipileSearchController');
const UnipileOutreachSequenceController = require('../controllers/UnipileOutreachSequenceController');
const CampaignUnipileSearchController = require('../controllers/CampaignUnipileSearchController');
const { authenticateToken } = require('../../../core/middleware/auth');

/**
 * @route POST /api/unipile/search
 * @desc Combined search for companies and leads on LinkedIn via Unipile
 * @access Private
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 * @body {string} industry - Industry filter (optional)
 * @body {string} location - Location filter (optional)
 * @body {string} designation - Job title/designation filter (optional)
 * @body {number} limit - Max results (default: 50)
 */
router.post('/search', authenticateToken, UnipileSearchController.search);

/**
 * @route POST /api/unipile/search/companies
 * @desc Search companies on LinkedIn via Unipile
 * @access Private
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 * @body {string} industry - Industry filter (optional)
 * @body {string} location - Location filter (optional)
 * @body {number} limit - Max results (default: 50)
 */
router.post('/search/companies', authenticateToken, UnipileSearchController.searchCompanies);

/**
 * @route POST /api/unipile/search/people
 * @desc Search people (leads) on LinkedIn via Unipile
 * @access Private
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 * @body {string} industry - Industry filter (optional)
 * @body {string} location - Location filter (optional)
 * @body {string} designation - Job title/designation filter (optional)
 * @body {string} company - Company filter (optional)
 * @body {number} limit - Max results (default: 50)
 */
router.post('/search/people', authenticateToken, UnipileSearchController.searchPeople);

/**
 * @route GET /api/unipile/profile/:linkedinId
 * @desc Get detailed profile information for a LinkedIn profile
 * @access Private
 * @query {string} accountId - Unipile LinkedIn account ID (required)
 */
router.get('/profile/:linkedinId', authenticateToken, UnipileSearchController.getProfile);

/**
 * ============================================
 * CAMPAIGN SEARCH ENDPOINTS (Unipile + Apollo Fallback)
 * ============================================
 */

/**
 * @route POST /api/unipile/campaign/search
 * @desc Search leads for campaign using Unipile (primary) with Apollo fallback
 * @access Private
 * @body {string} keywords - Search keywords (optional)
 * @body {string} industry - Industry name or ID (optional)
 * @body {string} location - Location name or ID (optional)
 * @body {string} designation - Job title/designation (optional)
 * @body {string} company - Company name/ID (optional)
 * @body {string} skills - Skills keywords (optional)
 * @body {number} limit - Max results (default: 50)
 * @body {string} accountId - Unipile account ID (optional, for Unipile primary)
 * @body {string} prefer_source - 'unipile' or 'apollo' (default: 'unipile')
 */
router.post('/campaign/search', authenticateToken, CampaignUnipileSearchController.searchLeadsForCampaign);

/**
 * @route GET /api/unipile/campaign/sources
 * @desc Get source statistics and capabilities
 * @access Private
 */
router.get('/campaign/sources', authenticateToken, CampaignUnipileSearchController.getSourceStats);

/**
 * @route POST /api/unipile/campaign/test-sources
 * @desc Test both Unipile and Apollo with sample parameters
 * @access Private
 * @body {string} keywords - Test keywords (default: 'Director')
 * @body {string} industry - Test industry (default: 'Technology')
 * @body {string} location - Test location (default: 'Dubai')
 * @body {string} accountId - Unipile account ID (optional)
 */
router.post('/campaign/test-sources', authenticateToken, CampaignUnipileSearchController.testSources);

/**
 * @route POST /api/unipile/campaign/compare
 * @desc Compare results from both sources
 * @access Private
 * @body {string} keywords - Search keywords (optional)
 * @body {string} industry - Industry to filter
 * @body {string} location - Location to filter
 * @body {string} designation - Job title to filter
 * @body {string} accountId - Unipile account ID (optional)
 */
router.post('/campaign/compare', authenticateToken, CampaignUnipileSearchController.compareSourceResults);

/**
 * ============================================
 * OUTREACH SEQUENCE ENDPOINTS
 * ============================================
 */

/**
 * @route POST /api/unipile/outreach/create
 * @desc Create an outreach sequence with scheduled sending slots
 * @access Private
 * @body {string} campaignId - Campaign ID (required)
 * @body {Array<string>} profileIds - LinkedIn profile IDs to contact (required)
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 * @body {string} message - Connection request message template (optional)
 * @body {number} dailyLimit - Daily invitation limit (default: 40, max: 80)
 * @body {string} startDate - Sequence start date ISO format (default: today)
 */
router.post('/outreach/create', authenticateToken, UnipileOutreachSequenceController.createSequence);

/**
 * @route GET /api/unipile/outreach/pending
 * @desc Get pending sending slots for today
 * @access Private
 * @query {string} accountId - Unipile LinkedIn account ID (required)
 */
router.get('/outreach/pending', authenticateToken, UnipileOutreachSequenceController.getPendingSlots);

/**
 * @route POST /api/unipile/outreach/send
 * @desc Send a connection request immediately
 * @access Private
 * @body {string} slotId - Sending slot ID (optional, for tracking)
 * @body {string} profileId - LinkedIn profile ID to contact (required)
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 * @body {string} message - Connection request message (optional)
 * @body {string} sequenceId - Sequence ID for tracking (optional)
 */
router.post('/outreach/send', authenticateToken, UnipileOutreachSequenceController.sendRequest);

/**
 * @route POST /api/unipile/outreach/process
 * @desc Process all pending slots for today (cron job)
 * @access Private
 * @body {string} accountId - Unipile LinkedIn account ID (required)
 */
router.post('/outreach/process', authenticateToken, UnipileOutreachSequenceController.processPending);

/**
 * @route GET /api/unipile/outreach/:sequenceId/status
 * @desc Get status of an outreach sequence
 * @access Private
 * @param {string} sequenceId - Sequence ID (required)
 */
router.get('/outreach/:sequenceId/status', authenticateToken, UnipileOutreachSequenceController.getStatus);

module.exports = router;
