/**
 * Inbound Leads Routes
 * Routes for managing inbound (uploaded) leads
 */
const express = require('express');
const router = express.Router();
const InboundLeadsController = require('../controllers/InboundLeadsController');
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');
// Save uploaded inbound leads
router.post('/', jwtAuth, InboundLeadsController.saveInboundLeads);
// Get inbound leads for tenant
router.get('/', jwtAuth, InboundLeadsController.getInboundLeads);
module.exports = router;