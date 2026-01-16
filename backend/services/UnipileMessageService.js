/**
 * Unipile Message Service
 * Handles LinkedIn direct messaging
 */

const axios = require('axios');
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
     */
    async sendLinkedInMessage(employee, messageText, accountId) {
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

            logger.debug('[Unipile] [Message] Looking up provider_id for LinkedIn DM target', { publicId });

            const lookupResponse = await axios.get(
                `${baseUrl}/users/${publicId}`,
                {
                    headers,
                    params: { account_id: accountId },
                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                }
            );

            const lookupData = lookupResponse.data?.data || lookupResponse.data || {};
            const providerId = lookupData.provider_id;

            if (!providerId) {
                throw new Error('No provider_id found for LinkedIn DM target');
            }

            logger.info('[Unipile] [Message] Found provider_id for DM target', { providerId });

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

            logger.debug('[Unipile] [Message] Creating chat for LinkedIn DM');

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

            logger.info('[Unipile] [Message] Chat created', { chatId });

            // STEP 3: Send message to /chats/{chat_id}/messages
            const messagePayload = {
                account_id: accountId,
                provider: 'linkedin',
                text: messageText
            };

            logger.debug('[Unipile] [Message] Sending DM', { chatId });

            const messageResponse = await axios.post(
                `${baseUrl}/chats/${chatId}/messages`,
                messagePayload,
                {
                    headers,
                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                }
            );

            return {
                success: true,
                data: messageResponse.data,
                chat_id: chatId
            };
        } catch (error) {
            logger.error('[Unipile] Error sending LinkedIn message', { error: error.message, stack: error.stack, status: error.response?.status, responseData: error.response?.data });
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = UnipileMessageService;

