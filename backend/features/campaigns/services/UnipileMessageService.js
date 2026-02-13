/**
 * Unipile Message Service
 * Handles LinkedIn direct messaging
 */
const axios = require('axios');
const { deductCredits } = require('../../../shared/middleware/credit_guard');
const { CREDIT_COSTS } = require('../../apollo-leads/constants/constants');
const logger = require('../../../core/utils/logger');

class UnipileMessageService {
    constructor(baseService) {
        this.base = baseService;
    }
    /**
     * Send a LinkedIn direct message using Unipile's chats/messages API.
     * 
     * Flow:
     * 1) Lookup the target profile to get provider_id / public_identifier
     * 2) Create a chat for that participant (provider = 'linkedin')
     * 3) Post a message to /chats/{chat_id}/messages with provider=linkedin
     * 
     * @param {Object} employee - Employee object with LinkedIn profile information
     * @param {string} messageText - Message text to send
     * @param {string} accountId - Unipile account ID
     * @param {Object} options - Additional options { tenantId, campaignId, leadId }
     */
    async sendLinkedInMessage(employee, messageText, accountId, options = {}) {
        const { tenantId, campaignId, leadId } = options;
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }
        if (!accountId) {
            throw new Error('Account ID is required to send LinkedIn message');
        }
        if (!messageText || !messageText.trim()) {
            throw new Error('Message text is required');
        }
        // Build LinkedIn URL / public identifier
        let linkedInUrl = employee.profile_url || employee.linkedin_url;
        if (!linkedInUrl) {
            if (employee.public_identifier) {
                linkedInUrl = `https://www.linkedin.com/in/${employee.public_identifier}`;
            } else {
                throw new Error(`Cannot determine LinkedIn URL for employee: ${employee.fullname || 'Unknown'}`);
            }
        }
        if (!linkedInUrl.startsWith('http')) {
            linkedInUrl = `https://www.linkedin.com/in/${linkedInUrl}`;
        }
        try {
            const baseUrl = this.base.getBaseUrl();
            const headers = this.base.getAuthHeaders();
            // STEP 1: Lookup provider_id via /users/{public_id}?account_id=...
            const match = linkedInUrl.match(/\/in\/([^/?]+)/);
            if (!match) {
                throw new Error(`Invalid LinkedIn URL format: ${linkedInUrl}. Expected format: https://www.linkedin.com/in/username/`);
            }
            const publicId = match[1];
            const lookupResponse = await axios.get(
                `${baseUrl}/users/${publicId}`,
                {
                    headers,
                    params: { account_id: accountId },
                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 60000
                }
            );
            const lookupData = lookupResponse.data?.data || lookupResponse.data || {};
            const providerId = lookupData.provider_id;
            if (!providerId) {
                throw new Error('No provider_id found for LinkedIn DM target');
            }
            // STEP 2: Create chat with this participant
            const chatPayload = {
                provider: 'linkedin',
                account_id: accountId,
                participants: [
                    {
                        provider: 'linkedin',
                        account_id: accountId,
                        provider_id: providerId,
                        public_identifier: lookupData.public_identifier || publicId
                    }
                ]
            };
            const chatResponse = await axios.post(
                `${baseUrl}/chats`,
                chatPayload,
                {
                    headers,
                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                }
            );
            const chatData = chatResponse.data?.data || chatResponse.data || {};
            const chatId = chatData.id || chatData.chat_id;
            if (!chatId) {
                throw new Error('Failed to create chat: no chat_id returned from Unipile');
            }
            // STEP 3: Send message to /chats/{chat_id}/messages
            const messagePayload = {
                account_id: accountId,
                provider: 'linkedin',
                text: messageText
            };
            const messageResponse = await axios.post(
                `${baseUrl}/chats/${chatId}/messages`,
                messagePayload,
                {
                    headers,
                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                }
            );
            
            // Deduct credits for successful message
            let creditsDeducted = 0;
            if (tenantId && messageText) {
                try {
                    const credits = CREDIT_COSTS.TEMPLATE_MESSAGE || 5;
                    const mockReq = { tenant: { id: tenantId } };
                    await deductCredits(tenantId, 'campaigns', 'template_message', credits, mockReq, {
                        campaignId: campaignId,
                        leadId: leadId,
                        stepType: 'linkedin_message'
                    });
                    creditsDeducted = credits;
                    // Credit deducted - logged by credit_guard
                } catch (creditError) {
                    // Error logged by credit_guard - don't duplicate
                }
            }
            
            return {
                success: true,
                data: messageResponse.data,
                chat_id: chatId,
                credits_used: creditsDeducted
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send first LinkedIn message to a newly accepted connection (create chat + send message in one call)
     * Uses POST /chats with text to both create the chat and send the first message
     * 
     * @param {string} accountId - Unipile account ID (sender)
     * @param {string} recipientProviderId - Recipient's LinkedIn provider ID (from connection.member_id)
     * @param {string} messageText - Message text to send
     * @param {Object} options - Additional options { tenantId, campaignId, leadId }
     * @returns {Promise<Object>} Result object with success status
     */
    async sendFirstLinkedInMessage(accountId, recipientProviderId, messageText, options = {}) {
        const { tenantId, campaignId, leadId } = options;
        
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }
        
        if (!accountId) {
            throw new Error('Account ID is required to send LinkedIn message');
        }
        
        if (!recipientProviderId) {
            throw new Error('Recipient provider ID is required');
        }
        
        if (!messageText || !messageText.trim()) {
            throw new Error('Message text is required');
        }
        
        try {
            const baseUrl = this.base.getBaseUrl();
            const headers = this.base.getAuthHeaders();
            
            // Create chat and send first message in one call (POST /chats with text)
            const chatPayload = {
                account_id: accountId,
                attendees_ids: [recipientProviderId],
                text: messageText
            };
            
            const chatResponse = await axios.post(
                `${baseUrl}/chats`,
                chatPayload,
                {
                    headers,
                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                }
            );
            
            const chatData = chatResponse.data?.data || chatResponse.data || {};
            const chatId = chatData.chat_id || chatData.id;
            
            if (!chatId) {
                logger.error('[UnipileMessageService] No chat_id in response', {
                    responseStatus: chatResponse.status,
                    responseData: chatResponse.data
                });
                throw new Error('Failed to create chat: no chat_id returned from Unipile');
            }
            
            // Deduct credits for successful message
            let creditsDeducted = 0;
            if (tenantId && messageText) {
                try {
                    const credits = CREDIT_COSTS.TEMPLATE_MESSAGE || 5;
                    const mockReq = { tenant: { id: tenantId } };
                    await deductCredits(tenantId, 'campaigns', 'template_message', credits, mockReq, {
                        campaignId: campaignId,
                        leadId: leadId,
                        stepType: 'linkedin_message'
                    });
                    creditsDeducted = credits;
                } catch (creditError) {
                    // Error logged by credit_guard - don't duplicate
                }
            }
            
            return {
                success: true,
                data: chatData,
                chat_id: chatId,
                chatId: chatId, // Also provide camelCase version
                credits_used: creditsDeducted
            };
        } catch (error) {
            logger.error('[UnipileMessageService] Error in sendFirstLinkedInMessage', {
                errorMessage: error.message,
                statusCode: error.response?.status,
                responseData: error.response?.data
            });
            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status,
                details: error.response?.data
            };
        }
    }
}
module.exports = UnipileMessageService;
