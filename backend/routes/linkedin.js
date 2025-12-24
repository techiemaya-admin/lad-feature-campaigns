/**
 * LinkedIn Integration Routes
 * Express routes for LinkedIn account management
 */

const express = require('express');
const router = express.Router();
const LinkedInController = require('../controllers/LinkedInController');
const { authenticateToken: jwtAuth } = require('../../../core/middleware/auth');

// OAuth flow
router.get('/auth/start', jwtAuth, LinkedInController.startAuth);
router.get('/auth/callback', LinkedInController.handleCallback); // No auth needed for callback

// Account management
router.get('/accounts', jwtAuth, LinkedInController.getAccounts);
router.get('/status', jwtAuth, LinkedInController.getStatus);
router.get('/account-status', jwtAuth, LinkedInController.getAccountStatus);
router.post('/disconnect', jwtAuth, LinkedInController.disconnect);
router.post('/sync', jwtAuth, LinkedInController.sync);
router.get('/sync-from-unipile', jwtAuth, LinkedInController.syncFromUnipile);

// Checkpoint and OTP
router.post('/solve-checkpoint', jwtAuth, LinkedInController.solveCheckpoint);
router.post('/verify-otp', jwtAuth, LinkedInController.verifyOTP);

// Connection management
router.post('/connect', jwtAuth, LinkedInController.connect);
router.post('/reconnect', jwtAuth, LinkedInController.reconnect);
router.post('/refresh', jwtAuth, LinkedInController.refreshToken);

// Webhooks
router.get('/webhooks', jwtAuth, LinkedInController.listWebhooks);
router.post('/register-webhook', jwtAuth, LinkedInController.registerWebhook);
router.post('/webhook', LinkedInController.handleWebhook); // No auth for webhook callback

module.exports = router;

