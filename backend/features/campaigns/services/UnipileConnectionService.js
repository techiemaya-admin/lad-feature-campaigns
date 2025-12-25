/**
 * Unipile Connection Service
 * Handles LinkedIn connection requests and invitation management
 */

const axios = require('axios');

class UnipileConnectionService {
    constructor(baseService) {
        this.base = baseService;
    }

    /**
     * Send connection request to a LinkedIn profile
     * 
     * @param {Object} employee - Employee object with LinkedIn profile information
     * @param {string} customMessage - Custom connection message (optional)
     * @param {string} accountId - Unipile account ID (required - must be from connect call)
     * @returns {Promise<Object>} Response from Unipile API
     */
    async sendConnectionRequest(employee, customMessage = null, accountId = null) {
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        if (!accountId) {
            throw new Error('Account ID is required. Please connect your LinkedIn account first using the connect endpoint.');
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

            // Normalize the URL (remove trailing slashes, ensure https)
            linkedInUrl = linkedInUrl.replace(/\/$/, '').replace(/^http:\/\//, 'https://');

            console.log(`[Unipile] Sending invitation to: ${employee.fullname || 'Unknown'} (${linkedInUrl})`);
            console.log(`[Unipile] Using account ID: ${accountId}`);

            // STEP 1: Lookup to get the actual provider_id for the TARGET profile
            console.log(`[Unipile] Step 1: Looking up provider_id for TARGET profile...`);
            
            const match = linkedInUrl.match(/\/in\/([^/?]+)/);
            if (!match) {
                throw new Error(`Invalid LinkedIn URL format: ${linkedInUrl}. Expected format: https://www.linkedin.com/in/username/`);
            }
            const publicId = match[1];
            
            console.log(`[Unipile] Target profile public identifier: ${publicId}`);
            
            const baseUrl = this.base.getBaseUrl();
            console.log(`[Unipile] Using base URL: ${baseUrl}`);
            const headers = this.base.getAuthHeaders();
            
            // Debug: Log auth headers (mask token for security)
            const authHeader = headers['X-API-KEY'] || headers['x-api-key'];
            if (authHeader) {
                const tokenPreview = authHeader.substring(0, 10) + '...';
                console.log(`[Unipile] Auth header present: YES (X-API-KEY preview: ${tokenPreview})`);
            } else {
                console.error(`[Unipile] ⚠️ WARNING: No X-API-KEY header found!`);
            }

            // Lookup the TARGET profile to get the encoded provider_id
            let lookupResponse;
            try {
                lookupResponse = await axios.get(
                    `${baseUrl}/users/${publicId}`,
                    {
                        headers: headers,
                        params: {
                            account_id: accountId
                        },
                        timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
                    }
                );
            } catch (lookupError) {
                // Handle 404 "Account not found" - account doesn't exist in Unipile
                if (lookupError.response?.status === 404) {
                    const errorDetail = lookupError.response.data?.detail || lookupError.response.data?.message || '';
                    if (errorDetail.includes('Account not found')) {
                        console.error(`[Unipile] ❌ Account ${accountId} not found in Unipile (404)`);
                        return {
                            success: false,
                            error: `Account not found in Unipile: ${accountId}`,
                            errorType: 'account_not_found',
                            statusCode: 404,
                            isAccountInvalid: true,
                            employee: { fullname: employee.fullname }
                        };
                    }
                }
                throw lookupError;
            }

            console.log(`[Unipile] Lookup response:`, JSON.stringify(lookupResponse.data, null, 2));

            // Handle response structure (may be wrapped in 'data' object)
            const responseData = lookupResponse.data?.data || lookupResponse.data;

            // Validate that we got the correct profile
            const returnedPublicId = responseData?.public_identifier;
            if (returnedPublicId && returnedPublicId.toLowerCase() !== publicId.toLowerCase()) {
                console.warn(`[Unipile] ⚠️ WARNING: Profile mismatch!`);
                console.warn(`[Unipile]   Requested: ${publicId}`);
                console.warn(`[Unipile]   Returned: ${returnedPublicId}`);
            }

            // Extract the encoded provider_id from lookup response
            const encodedProviderId = responseData?.provider_id || lookupResponse.data?.provider_id;

            if (!encodedProviderId) {
                throw new Error('No provider_id found in lookup response');
            }

            console.log(`[Unipile] ✅ Found target provider_id: ${encodedProviderId}`);

            // STEP 2: Send invitation with the ENCODED provider_id
            console.log(`[Unipile] Step 2: Sending invitation...`);

            const payload = {
                provider: 'LINKEDIN',
                account_id: accountId,
                provider_id: encodedProviderId
            };

            // Only include message if explicitly provided
            if (customMessage) {
                payload.message = customMessage;
                console.log(`[Unipile] Including custom message in connection request`);
            } else {
                console.log(`[Unipile] No custom message provided. Sending connection request without message to avoid monthly limit.`);
            }

            console.log(`[Unipile] Request payload:`, JSON.stringify(payload, null, 2));
            console.log(`[Unipile] Invitation endpoint: ${baseUrl}/users/invite`);

            let response;
            try {
                response = await axios.post(
                    `${baseUrl}/users/invite`,
                    payload,
                    {
                        headers: headers,
                        timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                    }
                );

                const statusCode = response.status;
                const responseData = response.data;
                
                console.log(`[Unipile] ✅ Invitation API call successful! Status: ${statusCode}`);
                
                if (statusCode >= 200 && statusCode < 300) {
                    if (responseData?.error || responseData?.type?.includes('error')) {
                        console.error(`[Unipile] ❌ Response contains error despite ${statusCode} status:`, responseData);
                        return {
                            success: false,
                            error: responseData?.detail || responseData?.message || 'API returned error in response',
                            errorType: responseData?.type,
                            details: responseData,
                            employee: { fullname: employee.fullname }
                        };
                    }
                    
                    console.log(`[Unipile] ✅ Confirmed: Invitation was actually sent to LinkedIn`);
                    return {
                        success: true,
                        data: responseData,
                        employee: {
                            fullname: employee.fullname,
                            profile_url: linkedInUrl,
                            provider_id: encodedProviderId
                        }
                    };
                } else {
                    console.error(`[Unipile] ❌ Unexpected status code: ${statusCode}`);
                    return {
                        success: false,
                        error: `Unexpected status code: ${statusCode}`,
                        details: responseData,
                        employee: { fullname: employee.fullname }
                    };
                }
            } catch (inviteError) {
                // Handle 409 (already sent)
                if (inviteError.response?.status === 409) {
                    console.warn(`[Unipile] ⚠️ Invitation already sent (409)`);
                    return {
                        success: true,
                        alreadySent: true,
                        data: inviteError.response.data,
                        employee: { fullname: employee.fullname }
                    };
                }

                // Handle 422 errors
                if (inviteError.response?.status === 422) {
                    const errorData = inviteError.response.data;
                    const errorType = errorData?.type || '';
                    const errorDetail = errorData?.detail || errorData?.message || '';
                    
                    console.error(`[Unipile] ❌ 422 Error:`, errorDetail);
                    
                    if (errorType.includes('already_invited') || 
                        (errorDetail.includes('already') && errorDetail.includes('invited') && !errorDetail.includes('limit'))) {
                        console.warn(`[Unipile] ⚠️ Invitation already sent (422) - treating as success`);
                        return {
                            success: true,
                            alreadySent: true,
                            data: errorData,
                            employee: { fullname: employee.fullname }
                        };
                    }
                    
                    if (errorType.includes('cannot_resend_yet') || 
                        errorDetail.includes('temporary provider limit') ||
                        errorDetail.includes('provider limit')) {
                        console.error(`[Unipile] ❌ Rate limit error - request was NOT sent. Error: ${errorDetail}`);
                        return {
                            success: false,
                            error: `Rate limit: ${errorDetail}`,
                            errorType: errorType,
                            isRateLimit: true,
                            details: errorData,
                            employee: { fullname: employee.fullname }
                        };
                    }
                    
                    return {
                        success: false,
                        error: errorDetail || 'Invitation failed (422)',
                        errorType: errorType,
                        details: errorData,
                        employee: { fullname: employee.fullname }
                    };
                }

                // Handle 400 errors
                if (inviteError.response?.status === 400) {
                    const detail = inviteError.response.data?.detail || '';
                    console.error(`[Unipile] ❌ 400 Error: ${detail}`);
                    
                    if (detail.includes('format')) {
                        return {
                            success: false,
                            error: 'Invalid provider_id format - lookup may have failed',
                            employee: { fullname: employee.fullname }
                        };
                    }
                }

                throw inviteError;
            }

        } catch (error) {
            console.error(`[Unipile] ❌ Error:`, error.message);
            if (error.response?.data) {
                console.error(`[Unipile] Response:`, error.response.data);
            }
            
            // Handle 429 rate limit errors
            if (error.response?.status === 429) {
                console.error(`[Unipile] 🚫 Rate limit exceeded (429)`);
                return {
                    success: false,
                    error: 'Rate limit exceeded - too many requests',
                    statusCode: 429,
                    errorType: 'rate_limit',
                    employee: {
                        fullname: employee.fullname,
                        profile_url: employee.profile_url || employee.linkedin_url
                    }
                };
            }

            let errorLinkedInUrl = employee.profile_url || employee.linkedin_url || 
                (employee.public_identifier ? `https://www.linkedin.com/in/${employee.public_identifier}` : null);

            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status,
                errorType: error.response?.data?.type,
                employee: {
                    fullname: employee.fullname,
                    profile_url: errorLinkedInUrl
                }
            };
        }
    }

    /**
     * Send connection requests to multiple employees
     * 
     * @param {Array} employees - Array of employee objects
     * @param {string} customMessage - Custom connection message (optional)
     * @param {string} accountId - Unipile account ID (required - must be from connect call)
     * @param {Object} options - Options for batch sending
     * @param {number} options.delay - Delay between requests in milliseconds (default: 2000)
     * @param {boolean} options.stopOnError - Stop on first error (default: false)
     * @returns {Promise<Object>} Results of all connection requests
     */
    async sendBatchConnectionRequests(employees, customMessage = null, accountId = null, options = {}) {
        const {
            delay = 2000,
            stopOnError = false
        } = options;

        if (!this.base.isConfigured()) {
            console.warn('[Unipile] Unipile not configured. Skipping batch connection requests.');
            return {
                success: false,
                error: 'Unipile is not configured',
                results: []
            };
        }

        if (!accountId) {
            console.warn('[Unipile] Account ID not provided. Skipping batch connection requests.');
            return {
                success: false,
                error: 'Account ID is required. Please connect your LinkedIn account first.',
                results: []
            };
        }

        const results = {
            total: employees.length,
            successful: 0,
            failed: 0,
            results: []
        };

        for (let i = 0; i < employees.length; i++) {
            const employee = employees[i];
            
            try {
                const result = await this.sendConnectionRequest(employee, customMessage, accountId);
                results.results.push(result);
                
                if (result.success) {
                    results.successful++;
                } else {
                    results.failed++;
                    
                    if (stopOnError) {
                        console.log(`[Unipile] Stopping batch due to error for: ${employee.fullname}`);
                        break;
                    }
                }
            } catch (error) {
                results.failed++;
                results.results.push({
                    success: false,
                    error: error.message,
                    employee: {
                        fullname: employee.fullname,
                        profile_url: employee.profile_url
                    }
                });
                
                if (stopOnError) {
                    console.log(`[Unipile] Stopping batch due to exception: ${error.message}`);
                    break;
                }
            }

            // Add delay between requests (except for the last one)
            if (i < employees.length - 1 && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log(`[Unipile] Batch complete: ${results.successful} successful, ${results.failed} failed out of ${results.total} total`);

        return {
            success: results.failed === 0,
            ...results
        };
    }

    /**
     * Check the status of sent invitations
     * This can be used for polling to detect connection acceptance
     * 
     * @param {Object} filters - Filters for invitations (optional)
     * @returns {Promise<Object>} List of invitations with their status
     */
    async getInvitationsStatus(filters = {}) {
        if (!this.base.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        try {
            const baseUrl = this.base.getBaseUrl();
            const response = await axios.get(
                `${baseUrl}/users/invitations`,
                {
                    headers: this.base.getAuthHeaders(),
                    params: filters,
                    timeout: 30000
                }
            );

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error('[Unipile] Error fetching invitations status:', error.message);
            throw error;
        }
    }
}

module.exports = UnipileConnectionService;

