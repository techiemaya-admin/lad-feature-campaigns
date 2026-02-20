/**
 * LinkedIn Integration Service
 * Main facade that combines all LinkedIn services
 * This file maintains backward compatibility while delegating to split modules
 */
// Import all services
const linkedInOAuthService = require('./LinkedInOAuthService');
const linkedInAccountService = require('./LinkedInAccountService');
const linkedInTokenService = require('./LinkedInTokenService');
const linkedInCheckpointService = require('./LinkedInCheckpointService');
const linkedInWebhookService = require('./LinkedInWebhookService');
class LinkedInIntegrationService {
  constructor() {
    // Services are already instantiated as singletons
  }
  // OAuth methods - delegate to LinkedInOAuthService
  async startLinkedInConnection(userId, redirectUri) {
    return linkedInOAuthService.startLinkedInConnection(userId, redirectUri);
  }
  async handleLinkedInCallback(userId, code, redirectUri) {
    return linkedInOAuthService.handleLinkedInCallback(userId, code, redirectUri);
  }
  async connectAccount(params) {
    return linkedInOAuthService.connectAccount(params);
  }
  async reconnectAccount(unipileAccountId) {
    return linkedInOAuthService.reconnectAccount(unipileAccountId);
  }
  async getAccountDetails(unipileAccountId) {
    return linkedInOAuthService.getAccountDetails(unipileAccountId);
  }
  // Helper method to extract LinkedIn profile URL (delegates to LinkedInOAuthService)
  extractLinkedInProfileUrl(unipileResponse) {
    return linkedInOAuthService.extractLinkedInProfileUrl(unipileResponse);
  }
  // Account management methods - delegate to LinkedInAccountService
  async disconnectAccount(userId, unipileAccountId) {
    return linkedInAccountService.disconnectAccount(userId, unipileAccountId);
  }
  async getUserLinkedInAccounts(tenantId) {
    return linkedInAccountService.getUserLinkedInAccounts(tenantId);
  }
  async getAllConnectedAccounts() {
    return linkedInAccountService.getAllConnectedAccounts();
  }
  async syncAccountData(account) {
    return linkedInAccountService.syncAccountData(account);
  }
  async syncFromUnipile(unipileAccountId) {
    return linkedInAccountService.syncFromUnipile(unipileAccountId);
  }
  // Token methods - delegate to LinkedInTokenService
  async refreshAccountToken(account) {
    return linkedInTokenService.refreshAccountToken(account);
  }
  // Checkpoint methods - delegate to LinkedInCheckpointService
  async solveCheckpoint(unipileAccountId, answer, checkpointType) {
    return linkedInCheckpointService.solveCheckpoint(unipileAccountId, answer, checkpointType);
  }
  async verifyOTP(unipileAccountId, otp) {
    return linkedInCheckpointService.verifyOTP(unipileAccountId, otp);
  }
  async verifyOTPAndSaveAccount(unipileAccountId, otp, userId, tenantId, email, schema) {
    return linkedInCheckpointService.verifyOTPAndSaveAccount(unipileAccountId, otp, userId, tenantId, email, schema);
  }
  // Webhook methods - delegate to LinkedInWebhookService
  async registerWebhook(webhookUrl, events, source) {
    return linkedInWebhookService.registerWebhook(webhookUrl, events, source);
  }
  async listWebhooks() {
    return linkedInWebhookService.listWebhooks();
  }
}
module.exports = new LinkedInIntegrationService();
