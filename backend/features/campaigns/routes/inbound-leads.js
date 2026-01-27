/**
 * Inbound Leads Routes
 * Routes for managing inbound (uploaded) leads
 */
const express = require('express');
const router = express.Router();
const InboundLeadsController = require('../controllers/InboundLeadsController');
const InboundLeadsValidator = require('../validators/inboundLeadsValidator');
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');

// Save uploaded inbound leads
router.post(
  '/', 
  jwtAuth, 
  InboundLeadsValidator.validateSaveLeadsRequest,
  InboundLeadsController.saveInboundLeads
);

// Cancel bookings for leads to re-nurture them
router.post(
  '/cancel-bookings',
  jwtAuth,
  InboundLeadsController.cancelBookingsForReNurturing
);

// Get inbound leads for tenant
router.get('/', jwtAuth, InboundLeadsController.getInboundLeads);

module.exports = router;
