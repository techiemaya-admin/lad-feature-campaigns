/**
 * Unipile Profile Service
 * Handles LinkedIn profile operations (follow, get contact details)
 * LAD Architecture Compliant - Uses logger instead of console
 */

const axios = require('axios');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
const UnipileAccountReconnectionService = require('./UnipileAccountReconnectionService');

class UnipileProfileService {
    constructor(baseService) {
        this.base = baseService;
        this.reconnectionService = new UnipileAccountReconnectionService(baseService);
    }

    /**
     * Follow a LinkedIn profile using Unipile's relations API.
     * This is a best-effort implementation based on /users/relations.
     * 
     * @param {Object} employee - Employee object with LinkedIn profile information
     * @param {string} accountId - Unipile account ID
     */
    async followLinkedInProfile(employee, accountId) {
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        if (!accountId) {
            throw new Error('Account ID is required to follow LinkedIn profile');
        }

        try {
            // Build LinkedIn URL
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

            const baseUrl = this.base.getBaseUrl();
            const headers = this.base.getAuthHeaders();

            // Extract public identifier
            const match = linkedInUrl.match(/\/in\/([^/?]+)/);
            if (!match) {
                throw new Error(`Invalid LinkedIn URL format: ${linkedInUrl}`);
            }
            const publicId = match[1];

            // Lookup provider_id
            const lookupResponse = await axios.get(
                `${baseUrl}/users/${publicId}`,
                {
                    headers,
                    params: { account_id: accountId },
                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                }
            ).catch(async (error) => {
                // Handle 401 errors with automatic reconnection
                if (error.response && error.response.status === 401) {
                    logger.warn('[Unipile] 401 Error on lookup - attempting automatic reconnection', { accountId, publicId });
                    
                    const reconnectResult = await this.reconnectionService.handle401Error(
                        accountId,
                        error,
                        async () => {
                            return await axios.get(
                                `${baseUrl}/users/${publicId}`,
                                {
                                    headers,
                                    params: { account_id: accountId },
                                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                                }
                            );
                        }
                    );

                    if (reconnectResult.success && reconnectResult.retried && reconnectResult.result) {
                        return reconnectResult.result;
                    }
                }
                throw error;
            });

            const lookupData = lookupResponse.data?.data || lookupResponse.data || {};
            const providerId = lookupData.provider_id;

            if (!providerId) {
                throw new Error('No provider_id found for LinkedIn profile');
            }

            // Follow the profile
            const followPayload = {
                provider: 'linkedin',
                account_id: accountId,
                provider_id: providerId
            };

            const response = await axios.post(
                `${baseUrl}/users/relations`,
                followPayload,
                {
                    headers,
                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                }
            ).catch(async (error) => {
                // Handle 401 errors with automatic reconnection
                if (error.response && error.response.status === 401) {
                    logger.warn('[Unipile] 401 Error on follow - attempting automatic reconnection', { accountId });
                    
                    const reconnectResult = await this.reconnectionService.handle401Error(
                        accountId,
                        error,
                        async () => {
                            return await axios.post(
                                `${baseUrl}/users/relations`,
                                followPayload,
                                {
                                    headers,
                                    timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                                }
                            );
                        }
                    );

                    if (reconnectResult.success && reconnectResult.retried && reconnectResult.result) {
                        return reconnectResult.result;
                    }
                }
                throw error;
            });

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            logger.error('[Unipile] Error following LinkedIn profile', { error: error.message, status: error.response?.status, responseData: error.response?.data });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get LinkedIn contact details (phone, email) from a profile
     * Uses Unipile's /users/{public_identifier} endpoint with linkedin_sections=*
     * 
     * @param {string} linkedinUrl - LinkedIn profile URL
     * @param {string} accountId - Unipile account ID
     * @returns {Promise<Object>} Contact details (phone, email) and profile info
     */
    async getLinkedInContactDetails(linkedinUrl, accountId) {
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        if (!accountId) {
            throw new Error('Account ID is required to fetch LinkedIn contact details');
        }

        try {
            // Extract public identifier from URL
            let publicIdentifier = linkedinUrl;
            if (linkedinUrl.includes('linkedin.com/in/')) {
                const match = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
                if (match) {
                    publicIdentifier = match[1];
                }
            }

            const baseUrl = this.base.getBaseUrl();
            const headers = this.base.getAuthHeaders();
            
            // Use Unipile API to get full profile with contact info
            const endpoint = `${baseUrl.replace('/api/v1', '')}/api/v1/users/${encodeURIComponent(publicIdentifier)}`;
            const params = {
                account_id: accountId,
                linkedin_sections: '*'
            };

            logger.debug('[Unipile] Fetching LinkedIn profile with contact info', { publicIdentifier, endpoint, accountId, baseUrl, hasToken: !!headers.Authorization, tokenLength: headers.Authorization?.length || 0 });

            // Attempt to fetch with automatic reconnection on 401
            let response;
            try {
                response = await axios.get(endpoint, {
                    headers: headers,
                    params: params,
                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                });
            } catch (error) {
                // Handle 401 errors with automatic reconnection
                if (error.response && error.response.status === 401) {
                    logger.warn('[Unipile] 401 Error received - attempting automatic reconnection', { accountId });
                    
                    // Try automatic reconnection with retry
                    const reconnectResult = await this.reconnectionService.handle401Error(
                        accountId, 
                        error,
                        async () => {
                            // Retry function: retry the original request
                            return await axios.get(endpoint, {
                                headers: headers,
                                params: params,
                                timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                            });
                        }
                    );

                    if (reconnectResult.success && reconnectResult.retried && reconnectResult.result) {
                        logger.info('[Unipile] Successfully retried request after reconnection', { accountId });
                        response = reconnectResult.result;
                    } else if (reconnectResult.requiresUserIntervention) {
                        logger.warn('[Unipile] Account requires user intervention', { accountId });
                        return {
                            success: false,
                            phone: null,
                            email: null,
                            error: reconnectResult.userMessage || 'Account requires re-authentication',
                            accountExpired: true,
                            accountId: accountId,
                            errorType: 'requires_user_intervention',
                            statusCode: 401
                        };
                    } else {
                        // Transient error - don't mark as expired, allow client to retry
                        logger.warn('[Unipile] Transient connection error - not marking as expired', { accountId });
                        return {
                            success: false,
                            phone: null,
                            email: null,
                            error: reconnectResult.userMessage || 'Temporary connection issue. Please retry.',
                            transientError: true,
                            accountId: accountId,
                            errorType: 'transient_error',
                            statusCode: 401
                        };
                    }
                } else {
                    // Non-401 errors should be re-thrown
                    throw error;
                }
            }

            if (!response) {
                throw new Error('Failed to get response from Unipile API');
            }

            const profileData = response.data;
            
            // Debug: Log contact_info structure
            if (profileData.contact_info) {
                logger.debug('[Unipile] Contact info structure', { 
                    keys: Object.keys(profileData.contact_info),
                    phonesLength: profileData.contact_info.phones?.length || 0,
                    phoneNumbersLength: profileData.contact_info.phone_numbers?.length || 0
                });
            }
            
            // Extract contact information from profile
            const emails = profileData.contact_info?.emails || [];
            const phones = profileData.contact_info?.phones || profileData.contact_info?.phone_numbers || [];
            
            // Extract email
            let email = null;
            if (emails.length > 0) {
                const firstEmail = emails[0];
                email = typeof firstEmail === 'string' 
                    ? firstEmail 
                    : (firstEmail.email || firstEmail.address || firstEmail.value || firstEmail);
            } else if (profileData.email) {
                email = profileData.email;
            }
            
            // Extract phone
            let phone = null;
            if (phones.length > 0) {
                const firstPhone = phones[0];
                if (typeof firstPhone === 'string') {
                    phone = firstPhone.trim();
                } else if (firstPhone.number) {
                    phone = String(firstPhone.number).trim();
                } else if (firstPhone.phone) {
                    phone = String(firstPhone.phone).trim();
                } else if (firstPhone.value) {
                    phone = String(firstPhone.value).trim();
                } else if (firstPhone.raw_number) {
                    phone = String(firstPhone.raw_number).trim();
                } else {
                    phone = String(firstPhone).trim();
                }
            } else if (profileData.phone_number) {
                phone = String(profileData.phone_number).trim();
            } else if (profileData.contact_info?.phone_number) {
                phone = String(profileData.contact_info.phone_number).trim();
            }

            logger.info('[Unipile] Contact details found', { hasPhone: !!phone, hasEmail: !!email });

            return {
                success: true,
                phone: phone,
                email: email,
                profile: {
                    first_name: profileData.first_name,
                    last_name: profileData.last_name,
                    headline: profileData.headline,
                    public_identifier: profileData.public_identifier,
                    summary: profileData.summary,
                    bio: profileData.bio,
                    company: profileData.company,
                    location: profileData.location,
                    title: profileData.title
                }
            };

        } catch (error) {
            logger.error('[Unipile] Error fetching LinkedIn contact details', { 
                error: error.message, 
                status: error.response?.status, 
                responseData: error.response?.data 
            });
            
            // Return failure so caller can fallback to other methods (e.g., Apollo)
            return {
                success: false,
                phone: null,
                email: null,
                error: error.message
            };
        }
    }
}

module.exports = UnipileProfileService;

