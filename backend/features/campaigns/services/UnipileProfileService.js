/**
 * Unipile Profile Service
 * Handles LinkedIn profile operations (follow, get contact details)
 * LAD Architecture Compliant - Uses logger instead of console
 */

const axios = require('axios');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class UnipileProfileService {
    constructor(baseService) {
        this.base = baseService;
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
            );

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
            );

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

            const response = await axios.get(endpoint, {
                headers: headers,
                params: params,
                timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
            }).catch(async (error) => {
                // Handle 401 errors - account credentials may have expired
                if (error.response && error.response.status === 401) {
                    const errorData = error.response.data || {};
                    const errorType = errorData.type || '';
                    const errorTitle = errorData.title || '';
                    
                    // Check if it's a missing credentials error
                    if (errorType.includes('missing_credentials') || errorTitle.includes('Missing credentials')) {
                        logger.warn('[Unipile] Account credentials expired or invalid, marking as inactive', { accountId });
                        
                        // Mark account as inactive in database
                        try {
                            const { pool } = require('../../../shared/database/connection');
                            const schema = getSchema(null); // No req available in this context
                            await pool.query(
                                `UPDATE ${schema}.linkedin_accounts 
                                 SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
                                 WHERE unipile_account_id = $1`,
                                [accountId]
                            );
                            logger.info('[Unipile] Marked account as inactive due to expired credentials', { accountId });
                        } catch (dbError) {
                            logger.error('[Unipile] Error updating account status', { accountId, error: dbError.message });
                        }
                    }
                }
                throw error;
            });

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
            logger.error('[Unipile] Error fetching LinkedIn contact details', { error: error.message, status: error.response?.status, responseData: error.response?.data });
            
            // Handle 401 errors - account credentials may have expired
            if (error.response && error.response.status === 401) {
                const errorData = error.response.data || {};
                const errorType = errorData.type || '';
                const errorTitle = errorData.title || '';
                
                // Check if it's a missing credentials error
                if (errorType.includes('missing_credentials') || errorTitle.includes('Missing credentials')) {
                    logger.warn('[Unipile] Account credentials expired or invalid, marking as inactive', { accountId });
                    
                    // Mark account as inactive in database
                    try {
                        const { pool } = require('../../../shared/database/connection');
                        const schema = getSchema(null); // No req available in this context
                        await pool.query(
                            `UPDATE ${schema}.linkedin_accounts 
                             SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
                             WHERE unipile_account_id = $1`,
                            [accountId]
                        );
                        logger.info('[Unipile] Marked account as inactive due to expired credentials', { accountId });
                        
                        // Also try to update old schema if it exists
                        try {
                            await pool.query(
                                `UPDATE ${schema}.user_integrations_voiceagent 
                                 SET is_connected = FALSE, updated_at = CURRENT_TIMESTAMP 
                                 WHERE (credentials->>'unipile_account_id' = $1 OR credentials->>'account_id' = $1)
                                 AND provider = 'linkedin'`,
                                [accountId]
                            );
                        } catch (oldSchemaError) {
                            // Old schema might not exist, that's okay
                        }
                    } catch (dbError) {
                        logger.error('[Unipile] Error updating account status', { accountId, error: dbError.message });
                    }
                        
                        return {
                            success: false,
                            phone: null,
                            email: null,
                            error: 'LinkedIn account credentials expired. Please reconnect your LinkedIn account in Settings.',
                            accountExpired: true,
                            accountId: accountId
                        };
                    }
                }
            }
            
            // Don't throw - return failure so caller can fallback to Apollo
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

