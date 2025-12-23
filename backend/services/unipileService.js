require('dotenv').config();
const axios = require('axios');

/**
 * Unipile Service for LinkedIn Connection Management
 * This service handles:
 * - Sending LinkedIn connection requests via Unipile API
 * - Tracking connection request status
 * - Handling connection acceptance notifications
 */
class UnipileService {
    constructor() {
        this.dsn = process.env.UNIPILE_DSN;
        this.token = process.env.UNIPILE_TOKEN;
        
        if (!this.dsn || !this.token) {
            console.warn('[Unipile] Warning: UNIPILE_DSN or UNIPILE_TOKEN not set. Unipile features will be disabled.');
        }
    }

    /**
     * Get base URL for Unipile API.
     * - If UNIPILE_DSN is provided, ensure it has /api/v1 path
     * - According to Unipile docs: endpoints are under /api/v1/
     */
    getBaseUrl() {
        const envDsn = (this.dsn || process.env.UNIPILE_DSN || '').trim();
        
        if (envDsn) {
            let url = envDsn;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = `https://${url}`;
            }
            // Remove trailing slashes
            url = url.replace(/\/+$/, '');
            
            // Ensure /api/v1 path is present
            if (!url.includes('/api/v1')) {
                url = `${url}/api/v1`;
            }
            
            return url;
        }
        
        // Fallback: canonical URL with /api/v1
        return 'https://api.unipile.com/api/v1';
    }

    /**
     * Check if Unipile is configured
     */
    isConfigured() {
        return !!(this.dsn && this.token);
    }

    /**
     * Get authentication headers for Unipile API
     * According to Unipile docs: Uses X-API-KEY header for authentication
     */
    getAuthHeaders() {
        const trimmedToken = (this.token || '').trim();
        if (!trimmedToken) {
            console.warn('[Unipile Service] ⚠️ UNIPILE_TOKEN is not set or is empty!');
            throw new Error('UNIPILE_TOKEN is not configured');
        }

        // Unipile API uses X-API-KEY header for authentication
        return {
            'X-API-KEY': trimmedToken,
            'Content-Type': 'application/json',
            'accept': 'application/json'
        };
    }

    /**
     * Lookup LinkedIn provider_id from profile URL or public identifier
     * Uses Unipile's /users/identifier endpoint to get the internal provider_id
     * 
     * @param {string} linkedinUrlOrSlug - LinkedIn profile URL or public identifier (e.g., "diana-jane-sioson-31b49195")
     * @param {string} accountId - Unipile account ID (required)
     * @returns {Promise<string>} LinkedIn provider_id (e.g., "urn:li:member:123456789")
     */
    async lookupLinkedInUrn(linkedinUrlOrSlug, accountId) {
        if (!this.isConfigured()) {
            throw new Error('Unipile is not configured. Please set UNIPILE_DSN and UNIPILE_TOKEN environment variables.');
        }

        if (!accountId) {
            throw new Error('Account ID is required for LinkedIn profile lookup');
        }

        try {
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();
            
            // Extract public identifier from URL if it's a full URL
            let providerPublicId = linkedinUrlOrSlug;
            if (linkedinUrlOrSlug.includes('linkedin.com/in/')) {
                const match = linkedinUrlOrSlug.match(/linkedin\.com\/in\/([^\/\?]+)/);
                if (match) {
                    providerPublicId = match[1];
                }
            }
            
            // Use Unipile's correct endpoint: GET /users/identifier
            const endpoint = `${baseUrl}/users/identifier`;
            const params = {
                provider: 'LINKEDIN',
                account_id: accountId,
                provider_public_id: providerPublicId
            };
            
            console.log(`[Unipile] Looking up provider_id for: ${providerPublicId}`);
            console.log(`[Unipile] Using endpoint: ${endpoint}`);
            console.log(`[Unipile] Query params:`, params);
            
            const response = await axios.get(endpoint, {
                headers: headers,
                params: params,
                timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
            });

            console.log(`[Unipile] Lookup response:`, JSON.stringify(response.data, null, 2));

            // Validate that the returned profile matches what we requested
            const returnedPublicId = response.data?.public_identifier;
            const returnedFirstName = response.data?.first_name;
            const returnedLastName = response.data?.last_name;
            const returnedFullName = `${returnedFirstName || ''} ${returnedLastName || ''}`.trim();
            
            // Normalize the requested identifier for comparison
            const requestedIdNormalized = providerPublicId.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const returnedIdNormalized = returnedPublicId ? returnedPublicId.toLowerCase().replace(/[^a-z0-9-]/g, '') : '';
            
            console.log(`[Unipile] Profile validation:`);
            console.log(`[Unipile]   Requested identifier: ${providerPublicId} (normalized: ${requestedIdNormalized})`);
            console.log(`[Unipile]   Returned identifier: ${returnedPublicId || 'N/A'} (normalized: ${returnedIdNormalized})`);
            console.log(`[Unipile]   Returned name: ${returnedFullName || 'N/A'}`);
            
            // Check if the returned profile matches the requested one
            if (returnedPublicId && returnedIdNormalized !== requestedIdNormalized && returnedIdNormalized !== 'identifier') {
                console.warn(`[Unipile] ⚠️ WARNING: Profile mismatch!`);
                console.warn(`[Unipile]   Requested: ${providerPublicId}`);
                console.warn(`[Unipile]   Returned: ${returnedPublicId}`);
                console.warn(`[Unipile]   This might indicate the lookup failed or returned a different profile.`);
            } else if (returnedPublicId === 'identifier' || !returnedPublicId) {
                console.warn(`[Unipile] ⚠️ WARNING: Unipile returned generic identifier or no identifier`);
                console.warn(`[Unipile]   This might indicate the profile lookup failed or the account lacks permission.`);
            }

            // Check if invitation already exists
            const invitation = response.data?.invitation;
            if (invitation) {
                console.log(`[Unipile] ⚠️ Invitation status found:`, JSON.stringify(invitation, null, 2));
                if (invitation.type === 'SENT' && invitation.status === 'PENDING') {
                    console.warn(`[Unipile] ⚠️ An invitation to this profile is already PENDING`);
                } else if (invitation.type === 'SENT' && invitation.status === 'ACCEPTED') {
                    console.warn(`[Unipile] ⚠️ An invitation to this profile was already ACCEPTED`);
                }
            }

            // Extract provider_id from response
            const providerId = response.data?.provider_id || 
                              response.data?.id ||
                              response.data?.urn_id ||
                              response.data?.urn;

            if (!providerId) {
                throw new Error('No provider_id found in Unipile response');
            }

            console.log(`[Unipile] ✅ Found provider_id: ${providerId}`);
            return {
                providerId: providerId,
                response: response.data,
                profileName: returnedFullName,
                publicIdentifier: returnedPublicId,
                requestedIdentifier: providerPublicId,
                profileMatch: returnedIdNormalized === requestedIdNormalized || returnedIdNormalized === 'identifier'
            };
            
        } catch (error) {
            console.error(`[Unipile] Error looking up LinkedIn provider_id:`, error.message);
            if (error.response) {
                console.error(`[Unipile] Error response:`, JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Send a LinkedIn connection request to an employee
     * Uses Unipile's API: POST /users/lookup to get provider_id, then POST /invitations to send invite
     * 
     * @param {Object} employee - Employee object with LinkedIn profile information
     * @param {string} employee.profile_url - LinkedIn profile URL (required)
     * @param {string} employee.fullname - Full name of the employee (optional)
     * @param {string} employee.public_identifier - LinkedIn public identifier (optional, will be extracted from URL if not provided)
     * @param {string} customMessage - Custom connection message (optional)
     * @param {string} accountId - Unipile account ID (required - must be from connect call)
     * @returns {Promise<Object>} Response from Unipile API
     */
    async sendConnectionRequest(employee, customMessage = null, accountId = null) {
        if (!this.isConfigured()) {
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
            
            const baseUrl = this.getBaseUrl();
            console.log(`[Unipile] Using base URL: ${baseUrl}`);
            const headers = this.getAuthHeaders();
            
            // Debug: Log auth headers (mask token for security)
            const authHeader = headers['X-API-KEY'] || headers['x-api-key'];
            if (authHeader) {
                const tokenPreview = authHeader.substring(0, 10) + '...';
                console.log(`[Unipile] Auth header present: YES (X-API-KEY preview: ${tokenPreview})`);
            } else {
                console.error(`[Unipile] ⚠️ WARNING: No X-API-KEY header found!`);
            }

            // Lookup the TARGET profile to get the encoded provider_id
            // According to Unipile docs: GET /api/v1/users/{provider_public_id}?account_id={account_id}
            // The provider_public_id goes in the URL path, account_id is required query parameter
            console.log(`[Unipile] Lookup endpoint: ${baseUrl}/users/${publicId}?account_id=${accountId}`);
            console.log(`[Unipile] Looking up provider_id for: ${publicId}`);

            let lookupResponse;
            try {
                lookupResponse = await axios.get(
                    `${baseUrl}/users/${publicId}`,  // Provider public ID in URL path
                    {
                        headers: headers,
                        params: {
                            account_id: accountId  // Required query parameter
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
                            isAccountInvalid: true,  // Flag to deactivate account
                            employee: { fullname: employee.fullname }
                        };
                    }
                }
                // Re-throw other errors
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
                console.warn(`[Unipile]   This might indicate the lookup returned a different profile.`);
            }

            // Extract the encoded provider_id from lookup response
            // Response may be: { data: { provider_id: ... } } or { provider_id: ... }
            const encodedProviderId = responseData?.provider_id || lookupResponse.data?.provider_id;

            if (!encodedProviderId) {
                throw new Error('No provider_id found in lookup response');
            }

            console.log(`[Unipile] ✅ Found target provider_id: ${encodedProviderId}`);
            console.log(`[Unipile]   Returned public_identifier: ${returnedPublicId || 'N/A'}`);
            const returnedName = responseData?.name || 
                                `${responseData?.first_name || ''} ${responseData?.last_name || ''}`.trim() ||
                                lookupResponse.data?.name ||
                                'N/A';
            console.log(`[Unipile]   Returned name: ${returnedName}`);

            // STEP 2: Send invitation with the ENCODED provider_id
            console.log(`[Unipile] Step 2: Sending invitation...`);

            const payload = {
                provider: 'LINKEDIN',
                account_id: accountId,
                provider_id: encodedProviderId  // ← Use the encoded ID from lookup, NOT the URL slug
            };

            // Only include message if explicitly provided (simple check like pluto_v8_1)
            // LinkedIn allows unlimited connection requests WITHOUT messages
            // But only 4-5 connection requests WITH messages per month
            // To avoid hitting monthly limits, we skip the message unless explicitly provided
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
                    `${baseUrl}/users/invite`,  // ← Correct endpoint per Unipile docs
                    payload,
                    {
                        headers: headers,
                        timeout: Number(process.env.UNIPILE_PROFILE_TIMEOUT_MS) || 30000
                    }
                );

                // Verify the response indicates actual success
                const statusCode = response.status;
                const responseData = response.data;
                
                console.log(`[Unipile] ✅ Invitation API call successful! Status: ${statusCode}`);
                console.log(`[Unipile] Response:`, JSON.stringify(responseData, null, 2));
                
                // Only treat as success if we get 200/201 status
                // Some APIs return 200 even on errors, so check response data too
                if (statusCode >= 200 && statusCode < 300) {
                    // Check if response indicates actual success (not an error in disguise)
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

                // Handle 422 errors (rate limiting, already invited recently, etc.)
                if (inviteError.response?.status === 422) {
                    const errorData = inviteError.response.data;
                    const errorType = errorData?.type || '';
                    const errorDetail = errorData?.detail || errorData?.message || '';
                    
                    console.error(`[Unipile] ❌ 422 Error:`, errorDetail);
                    console.error(`[Unipile] Error type:`, errorType);
                    console.error(`[Unipile] Full error response:`, JSON.stringify(errorData, null, 2));
                    
                    // Only treat as success if it explicitly says "already invited" (not rate limit)
                    // "cannot_resend_yet" with "temporary provider limit" = RATE LIMIT (NOT sent, treat as failure)
                    // "already_invited" = Already sent (treat as success)
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
                    
                    // "cannot_resend_yet" with "temporary provider limit" = Rate limit, NOT sent
                    // This means the request was NOT sent, so treat as failure
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
                    
                    // For other 422 errors, return with details
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

                console.error(`[Unipile] ❌ Error:`, inviteError.message);
                if (inviteError.response?.data) {
                    console.error(`[Unipile] Response:`, inviteError.response.data);
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

            // Reconstruct LinkedIn URL for error response
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
            delay = 2000, // 2 second delay between requests to avoid rate limiting
            stopOnError = false
        } = options;

        if (!this.isConfigured()) {
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
        if (!this.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        try {
            const baseUrl = this.getBaseUrl();
            const response = await axios.get(
                `${baseUrl}/users/invitations`,
                {
                    headers: this.getAuthHeaders(),
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
        if (!this.isConfigured()) {
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
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();

            // STEP 1: Lookup provider_id via /users/{public_id}?account_id=...
            const match = linkedInUrl.match(/\/in\/([^/?]+)/);
            if (!match) {
                throw new Error(`Invalid LinkedIn URL format: ${linkedInUrl}. Expected format: https://www.linkedin.com/in/username/`);
            }
            const publicId = match[1];

            console.log(`[Unipile] [Message] Looking up provider_id for LinkedIn DM target: ${publicId}`);

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

            console.log(`[Unipile] [Message] ✅ Found provider_id for DM target: ${providerId}`);

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

            console.log(`[Unipile] [Message] Creating chat for LinkedIn DM...`);

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

            console.log(`[Unipile] [Message] ✅ Chat created with id: ${chatId}`);

            // STEP 3: Send message to /chats/{chat_id}/messages
            const messagePayload = {
                account_id: accountId,
                provider: 'linkedin',
                text: messageText
            };

            console.log(`[Unipile] [Message] Sending DM via chat ${chatId}...`);

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
            console.error('[Unipile] ❌ Error sending LinkedIn message:', error.message);
            if (error.response) {
                console.error('[Unipile] Response status:', error.response.status);
                console.error('[Unipile] Response data:', error.response.data);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Follow a LinkedIn profile using Unipile's relations API.
     * This is a best-effort implementation based on /users/relations.
     * 
     * @param {Object} employee - Employee object with LinkedIn profile information
     * @param {string} accountId - Unipile account ID
     */
    async followLinkedInProfile(employee, accountId) {
        if (!this.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        if (!accountId) {
            throw new Error('Account ID is required to follow LinkedIn profile');
        }

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
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();

            // Lookup provider_id first
            const match = linkedInUrl.match(/\/in\/([^/?]+)/);
            if (!match) {
                throw new Error(`Invalid LinkedIn URL format: ${linkedInUrl}. Expected format: https://www.linkedin.com/in/username/`);
            }
            const publicId = match[1];

            console.log(`[Unipile] [Follow] Looking up provider_id for follow target: ${publicId}`);

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
                throw new Error('No provider_id found for follow target');
            }

            console.log(`[Unipile] [Follow] ✅ Found provider_id for follow target: ${providerId}`);

            // Call /users/relations with action=follow (best-effort based on Unipile docs)
            const payload = {
                provider: 'linkedin',
                account_id: accountId,
                provider_id: providerId,
                action: 'follow'
            };

            console.log('[Unipile] [Follow] Sending follow request via /users/relations...');

            const response = await axios.post(
                `${baseUrl}/users/relations`,
                payload,
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
            console.error('[Unipile] ❌ Error following LinkedIn profile:', error.message);
            if (error.response) {
                console.error('[Unipile] Response status:', error.response.status);
                console.error('[Unipile] Response data:', error.response.data);
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get LinkedIn profile with contact details (phone/email) from LinkedIn URL
     * This checks the LinkedIn profile directly via Unipile API before triggering Apollo
     * 
     * @param {string} linkedinUrl - LinkedIn profile URL (e.g., "https://www.linkedin.com/in/username")
     * @param {string} accountId - Unipile account ID (required)
     * @returns {Promise<Object>} Profile data with contact info: { phone: string|null, email: string|null, success: boolean }
     */
    async getLinkedInContactDetails(linkedinUrl, accountId) {
        if (!this.isConfigured()) {
            throw new Error('Unipile is not configured');
        }

        if (!accountId) {
            throw new Error('Account ID is required for LinkedIn profile lookup');
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

            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();
            
            // Use Unipile API to get full profile with contact info
            // Add linkedin_sections=* to get contact_info section
            const endpoint = `${baseUrl.replace('/api/v1', '')}/api/v1/users/${encodeURIComponent(publicIdentifier)}`;
            const params = {
                account_id: accountId,
                linkedin_sections: '*' // Request all sections including contact_info
            };

            console.log(`[Unipile] Fetching LinkedIn profile with contact info for: ${publicIdentifier}`);
            console.log(`[Unipile] Endpoint: ${endpoint}`);

            const response = await axios.get(endpoint, {
                headers: headers,
                params: params,
                timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || 15000
            });

            const profileData = response.data;
            
            // Debug: Log contact_info structure to understand Unipile's response format
            if (profileData.contact_info) {
                console.log(`[Unipile] 📋 Contact info keys:`, Object.keys(profileData.contact_info));
                if (profileData.contact_info.phones) {
                    console.log(`[Unipile] 📱 Phones array length:`, profileData.contact_info.phones.length);
                    console.log(`[Unipile] 📱 First phone item:`, JSON.stringify(profileData.contact_info.phones[0], null, 2));
                }
                if (profileData.contact_info.phone_numbers) {
                    console.log(`[Unipile] 📱 Phone_numbers array length:`, profileData.contact_info.phone_numbers.length);
                    console.log(`[Unipile] 📱 First phone_number item:`, JSON.stringify(profileData.contact_info.phone_numbers[0], null, 2));
                }
            }
            
            // Extract contact information from profile
            const emails = profileData.contact_info?.emails || [];
            const phones = profileData.contact_info?.phones || profileData.contact_info?.phone_numbers || [];
            
            // Extract email - handle both string and object formats
            let email = null;
            if (emails.length > 0) {
                const firstEmail = emails[0];
                email = typeof firstEmail === 'string' 
                    ? firstEmail 
                    : (firstEmail.email || firstEmail.address || firstEmail.value || firstEmail);
            } else if (profileData.email) {
                email = profileData.email;
            }
            
            // Extract phone - handle both string and object formats
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

            console.log(`[Unipile] Contact details found - Phone: ${phone ? `Yes (${phone})` : 'No'}, Email: ${email ? `Yes (${email})` : 'No'}`);

            return {
                success: true,
                phone: phone,
                email: email,
                profile: {
                    first_name: profileData.first_name,
                    last_name: profileData.last_name,
                    headline: profileData.headline,
                    public_identifier: profileData.public_identifier
                }
            };

        } catch (error) {
            console.error(`[Unipile] Error fetching LinkedIn contact details:`, error.message);
            if (error.response) {
                console.error(`[Unipile] Response status: ${error.response.status}`);
                console.error(`[Unipile] Response data:`, error.response.data);
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

// Export singleton instance
module.exports = new UnipileService();


