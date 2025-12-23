/**
 * Unipile Service for LinkedIn Connection Management
 * 
 * This service handles:
 * - Sending LinkedIn connection requests via Unipile API
 * - Tracking connection request status
 * - Handling connection acceptance notifications
 * - Sending LinkedIn messages
 * - Following LinkedIn profiles
 * - Getting LinkedIn contact details
 * 
 * This is a composite service that combines:
 * - UnipileBaseService: Base configuration and utilities
 * - UnipileConnectionService: Connection requests
 * - UnipileMessageService: Direct messaging
 * - UnipileProfileService: Profile operations
 */

const UnipileBaseService = require('./UnipileBaseService');
const UnipileConnectionService = require('./UnipileConnectionService');
const UnipileMessageService = require('./UnipileMessageService');
const UnipileProfileService = require('./UnipileProfileService');

class UnipileService {
    constructor() {
        // Initialize base service
        this.base = new UnipileBaseService();
        
        // Initialize specialized services
        this.connection = new UnipileConnectionService(this.base);
        this.message = new UnipileMessageService(this.base);
        this.profile = new UnipileProfileService(this.base);
    }

    // Base service methods
    getBaseUrl() {
        return this.base.getBaseUrl();
    }

    isConfigured() {
        return this.base.isConfigured();
    }

    getAuthHeaders() {
        return this.base.getAuthHeaders();
    }

    async lookupLinkedInUrn(linkedinUrlOrSlug, accountId) {
        return this.base.lookupLinkedInUrn(linkedinUrlOrSlug, accountId);
    }

    // Connection service methods
    async sendConnectionRequest(employee, customMessage = null, accountId = null) {
        return this.connection.sendConnectionRequest(employee, customMessage, accountId);
    }

    async sendBatchConnectionRequests(employees, customMessage = null, accountId = null, options = {}) {
        return this.connection.sendBatchConnectionRequests(employees, customMessage, accountId, options);
    }

    async getInvitationsStatus(filters = {}) {
        return this.connection.getInvitationsStatus(filters);
    }

    // Message service methods
    async sendLinkedInMessage(employee, messageText, accountId) {
        return this.message.sendLinkedInMessage(employee, messageText, accountId);
    }

    // Profile service methods
    async followLinkedInProfile(employee, accountId) {
        return this.profile.followLinkedInProfile(employee, accountId);
    }

    async getLinkedInContactDetails(linkedinUrl, accountId) {
        return this.profile.getLinkedInContactDetails(linkedinUrl, accountId);
    }
}

// Export singleton instance for backward compatibility
module.exports = new UnipileService();
