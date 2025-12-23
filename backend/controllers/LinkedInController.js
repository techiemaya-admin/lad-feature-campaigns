/**
 * LinkedIn Integration Controller
 * Main facade that combines all LinkedIn controllers
 * This file maintains backward compatibility while delegating to split controllers
 */

// Import all controllers
const LinkedInAuthController = require('./LinkedInAuthController');
const LinkedInAccountController = require('./LinkedInAccountController');
const LinkedInWebhookController = require('./LinkedInWebhookController');

class LinkedInController {
  // Auth methods - delegate to LinkedInAuthController
  static async startAuth(req, res) {
    return LinkedInAuthController.startAuth(req, res);
  }

  static async handleCallback(req, res) {
    return LinkedInAuthController.handleCallback(req, res);
  }

  static async connect(req, res) {
    return LinkedInAuthController.connect(req, res);
  }

  static async reconnect(req, res) {
    return LinkedInAuthController.reconnect(req, res);
  }

  static async solveCheckpoint(req, res) {
    return LinkedInAuthController.solveCheckpoint(req, res);
  }

  static async verifyOTP(req, res) {
    return LinkedInAuthController.verifyOTP(req, res);
  }

  // Account methods - delegate to LinkedInAccountController
  static async getAccounts(req, res) {
    return LinkedInAccountController.getAccounts(req, res);
  }

  static async getStatus(req, res) {
    return LinkedInAccountController.getStatus(req, res);
  }

  static async getAccountStatus(req, res) {
    return LinkedInAccountController.getAccountStatus(req, res);
  }

  static async disconnect(req, res) {
    return LinkedInAccountController.disconnect(req, res);
  }

  static async sync(req, res) {
    return LinkedInAccountController.sync(req, res);
  }

  static async syncFromUnipile(req, res) {
    return LinkedInAccountController.syncFromUnipile(req, res);
  }

  static async refreshToken(req, res) {
    return LinkedInAccountController.refreshToken(req, res);
  }

  // Webhook methods - delegate to LinkedInWebhookController
  static async registerWebhook(req, res) {
    return LinkedInWebhookController.registerWebhook(req, res);
  }

  static async listWebhooks(req, res) {
    return LinkedInWebhookController.listWebhooks(req, res);
  }

  static async handleWebhook(req, res) {
    return LinkedInWebhookController.handleWebhook(req, res);
  }
}

module.exports = LinkedInController;

