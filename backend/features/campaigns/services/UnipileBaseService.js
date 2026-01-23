/**
 * Unipile Base Service
 * Handles base configuration, authentication, and utility methods
 * LAD Architecture Compliant - Uses logger instead of console
 */
const path = require('path');
const fs = require('fs');
const { API_CONFIG } = require('../constants');
// Load .env file from project root (lad-feature-campaigns/.env)
try {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    // Fallback: try current directory
    require('dotenv').config();
  }
} catch (e) {
  // dotenv not available, that's okay
  require('dotenv').config();
}
const axios = require('axios');
class UnipileBaseService {
    constructor() {
        this.dsn = process.env.UNIPILE_DSN;
        this.token = process.env.UNIPILE_TOKEN;
        if (!this.dsn || !this.token) {
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
        // Fallback: canonical URL with /api/v1 (from environment or constants)
        const defaultUrl = process.env.UNIPILE_API_BASE_URL || API_CONFIG.UNIPILE_DEFAULT_BASE_URL;
        return defaultUrl;
    }
    /**
     * Check if Unipile is configured
     */
    isConfigured() {
        return !!(this.dsn && this.token);
    }
    /**
     * Get authentication headers for Unipile API
     * According to Unipile docs: Uses X-API-KEY header with Access Token
     * Confirmed working via direct API testing
     */
    getAuthHeaders() {
        const trimmedToken = (this.token || '').trim();
        if (!trimmedToken) {
            throw new Error('UNIPILE_TOKEN is not configured');
        }
        // Unipile API uses X-API-KEY header with the Access Token
        // This is the correct authentication method for all Unipile API endpoints
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
            const response = await axios.get(
                `${baseUrl}/users/${providerPublicId}`,
                {
                    headers: headers,
                    params: {
                        account_id: accountId
                    },
                    timeout: Number(process.env.UNIPILE_LOOKUP_TIMEOUT_MS) || API_CONFIG.UNIPILE_LOOKUP_TIMEOUT_MS
                }
            );
            // Handle response structure (may be wrapped in 'data' object)
            const responseData = response.data?.data || response.data;
            const providerId = responseData?.provider_id;
            if (!providerId) {
                throw new Error('No provider_id found in lookup response');
            }
            return providerId;
        } catch (error) {
                error: error.message, 
                status: error.response?.status,
                responseData: error.response?.data,
                stack: error.stack 
            });
            throw error;
        }
    }
}
module.exports = UnipileBaseService;