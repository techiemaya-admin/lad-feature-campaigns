/**
 * Apollo Reveal Service
 * LAD Architecture Compliant - Email and phone reveal operations
 * 
 * Handles revealing emails and phone numbers with proper tenant scoping and caching.
 * Includes refund mechanism for failed API calls to prevent credit loss.
 */

const axios = require('axios');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { requireTenantId } = require('../../../core/utils/tenantHelper');
const { APOLLO_CONFIG, CACHE_CONFIG, CREDIT_COSTS } = require('../constants/constants');
const { refundCredits, deductCredits } = require('../../../shared/middleware/credit_guard');
const logger = require('../../../core/utils/logger');
const ApolloEmployeesCacheRepository = require('../repositories/ApolloEmployeesCacheRepository');

class ApolloRevealService {
  constructor(apiKey, baseURL) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  /**
   * Check if email is fake/placeholder
   * @private
   */
  _isFakeEmail(email) {
    if (!email) return true;
    const emailLower = email.toLowerCase();
    return CACHE_CONFIG.FAKE_EMAIL_PATTERNS.some(pattern => emailLower.includes(pattern));
  }

  /**
   * Attempt to refund credits for failed operations
   * FIX: Implements credit refund mechanism for validation errors
   * @private
   */
  async _attemptRefund(tenantId, usageType, credits, req, reason = 'Operation failed') {
    try {
      if (req && tenantId && credits > 0) {
        await refundCredits(tenantId, usageType, credits, req, reason);
        logger.info('[Apollo Reveal] Credits refunded', { tenantId, credits, usageType, reason });
      }
    } catch (refundError) {
      logger.error('[Apollo Reveal] Failed to refund credits', { 
        tenantId, 
        credits, 
        error: refundError.message 
      });
      // Don't throw - refund failure shouldn't block user response
    }
  }

  /**
   * Reveal email - checks database cache first, then calls Apollo API
   * LAD Architecture: Uses tenant scoping and delegates SQL to repository
   * 
   * FIX: Validate personId is a valid Apollo person ID format (numeric string)
   * Apollo person IDs are numeric values, not UUIDs. If the ID looks like a UUID,
   * it's likely a database record ID and needs to be resolved to an Apollo person ID.
   */
  async revealEmail(personId, employeeName = null, req = null) {
    const tenantId = requireTenantId(null, req, 'revealEmail');
    const schema = getSchema(req);
    
    try {
      // STEP 1: Check employees_cache table first (0 credits)
      if (personId || employeeName) {
        let cachedEmployee;
        
        try {
          if (personId) {
            // LAD Architecture: Use repository for SQL operations
            cachedEmployee = await ApolloEmployeesCacheRepository.findByPersonId(personId, tenantId, schema);
          } else if (employeeName) {
            // LAD Architecture: Use repository for SQL operations
            cachedEmployee = await ApolloEmployeesCacheRepository.findByName(employeeName, tenantId, schema);
          }
          
          if (cachedEmployee?.employee_email && !this._isFakeEmail(cachedEmployee.employee_email)) {
            const cachedEmail = cachedEmployee.employee_email;
            logger.info('[Apollo Reveal] Real email found in cache', { from_cache: true, credits_used: 0 });
            
            return { email: cachedEmail, from_cache: true, credits_used: 0 };
          }
        } catch (cacheError) {
          logger.warn('[Apollo Reveal] Error checking cache', { error: cacheError.message });
        }
      }
      
      // STEP 2: If no cached email, call Apollo API (1 credit)
      if (!this.apiKey) {
        throw new Error('Apollo API key is not configured');
      }
      
      // Apollo API v1 endpoint for email reveal - using people/bulk_match (same as search enrichment)
      const apolloUrl = `${this.baseURL || APOLLO_CONFIG.DEFAULT_BASE_URL}/people/bulk_match`;
      
      if (!personId) {
        return { email: null, from_cache: false, credits_used: 0, error: 'Person ID is required for email reveal' };
      }
      
      // CRITICAL FIX: Validate personId format
      // Apollo person IDs are numeric. If we receive a UUID format ID (likely a database record ID),
      // we should reject it and not call Apollo API
      const isUUIDFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(personId));
      if (isUUIDFormat) {
        logger.warn('[Apollo Reveal] Person ID has UUID format - likely a database ID, not an Apollo person ID', { personId });
        // Refund credits for validation error - no service provided
        await this._attemptRefund(tenantId, 'apollo_email', CREDIT_COSTS.EMAIL_REVEAL, req, 'Invalid person ID format');
        return { 
          email: null, 
          from_cache: false, 
          credits_used: 0, 
          error: 'Invalid person ID format. Apollo expects numeric person IDs from search results.',
          validation_error: true
        };
      }
      
      // Validate personId is numeric or at least not completely invalid
      const personIdNum = Number(personId);
      if (isNaN(personIdNum) && personId && personId.length > 50) {
        logger.warn('[Apollo Reveal] Person ID format appears invalid for Apollo API', { personId, length: personId.length });
        // Refund credits for validation error - no service provided
        await this._attemptRefund(tenantId, 'apollo_email', CREDIT_COSTS.EMAIL_REVEAL, req, 'Invalid person ID format');
        return { 
          email: null, 
          from_cache: false, 
          credits_used: 0, 
          error: 'Invalid person ID format. Expected numeric Apollo person ID.',
          validation_error: true
        };
      }
      
      // FIXED: Use bulk_match format (same as test file)
      const apolloRequest = {
        details: [{ id: personId }],
        reveal_personal_emails: true
      };
      
      logger.debug('[Apollo Reveal] Email reveal request', { 
        url: apolloUrl, 
        body: apolloRequest,
        personId 
      });
      
      const apolloResponse = await axios.post(apolloUrl, apolloRequest, {
        headers: {
          'x-api-key': this.apiKey,  // FIXED: lowercase x-api-key (consistent with search API)
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      // FIXED: bulk_match returns matches array, not single person
      const matches = apolloResponse.data?.matches || [];
      const person = matches.length > 0 ? matches[0] : null;
      const email = person?.email || person?.personal_emails?.[0];
      if (!email || this._isFakeEmail(email)) {
        logger.warn('[Apollo Reveal] Real email not available from Apollo API');
        return { email: null, from_cache: false, credits_used: CREDIT_COSTS.EMAIL_REVEAL, error: 'Real email not available for this person' };
      }
      
      logger.info('[Apollo Reveal] Email revealed successfully from Apollo', { credits_used: CREDIT_COSTS.EMAIL_REVEAL });
      
      // STEP 3: Update cache with real email
      try {
        // LAD Architecture: Use repository for SQL operations
        await ApolloEmployeesCacheRepository.updateEmail(personId, email, tenantId, schema);
        logger.debug('[Apollo Reveal] Real email saved to employees_cache');
      } catch (cacheError) {
        logger.warn('[Apollo Reveal] Error caching email', { error: cacheError.message });
      }
      
      return { email, from_cache: false, credits_used: CREDIT_COSTS.EMAIL_REVEAL };
    } catch (error) {
      logger.error('[Apollo Reveal] Reveal email error', { 
        error: error.message, 
        stack: error.stack,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data
      });
      
      // CRITICAL FIX: Refund credits for client errors (4xx)
      // Client errors mean the request was malformed or invalid - no service provided
      // Only charge credits for successful reveals (200) or server errors (5xx retry)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        logger.warn('[Apollo Reveal] Refunding credits due to client error (4xx)', { 
          status: error.response?.status,
          error: error.response?.data?.message || error.message
        });
        await this._attemptRefund(tenantId, 'apollo_email', CREDIT_COSTS.EMAIL_REVEAL, req, `Apollo API error: ${error.response?.status} ${error.response?.data?.message || error.message}`);
        return { 
          email: null, 
          from_cache: false, 
          credits_used: 0, // No charge for invalid requests
          error: `Apollo API error: ${error.response?.data?.message || error.message}`,
          apollo_status: error.response?.status
        };
      }
      
      // For server errors (5xx), don't refund - retry could succeed
      const creditsUsed = error.response?.status >= 500 ? CREDIT_COSTS.EMAIL_REVEAL : 0;
      
      return { 
        email: null, 
        from_cache: false, 
        credits_used: creditsUsed, 
        error: `${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}` 
      };
    }
  }

  /**
   * Reveal phone - checks database cache first, then calls Apollo API
   * LAD Architecture: Uses tenant scoping and delegates SQL to repository
   * 
   * FIX: Validate personId is a valid Apollo person ID format (numeric string)
   * Apollo person IDs are numeric values, not UUIDs. If the ID looks like a UUID,
   * it's likely a database record ID and needs to be resolved to an Apollo person ID.
   */
  async revealPhone(personId, employeeName = null, req = null) {
    const tenantId = requireTenantId(null, req, 'revealPhone');
    const schema = getSchema(req);
    
    try {
      // STEP 1: Check employees_cache table first (0 credits)
      if (personId || employeeName) {
        let cachedEmployee;
        
        try {
          if (personId) {
            // LAD Architecture: Use repository for SQL operations
            cachedEmployee = await ApolloEmployeesCacheRepository.findByPersonId(personId, tenantId, schema);
          } else if (employeeName) {
            // LAD Architecture: Use repository for SQL operations  
            cachedEmployee = await ApolloEmployeesCacheRepository.findByName(employeeName, tenantId, schema);
          }
          
          if (cachedEmployee?.employee_phone && cachedEmployee.employee_phone.trim() !== '') {
            const cachedPhone = cachedEmployee.employee_phone;
            logger.info('[Apollo Reveal] Real phone found in cache', { from_cache: true, credits_used: 0 });
            
            return { phone: cachedPhone, from_cache: true, credits_used: 0 };
          }
        } catch (cacheError) {
          logger.warn('[Apollo Reveal] Error checking cache', { error: cacheError.message });
        }
      }
      
      // STEP 2: If no cached phone, call Apollo API (8 credits)
      if (!this.apiKey) {
        throw new Error('Apollo API key is not configured');
      }
      
      // Apollo API v1 endpoint for phone reveal - using people/match with reveal flag
      const apolloUrl = `${this.baseURL || APOLLO_CONFIG.DEFAULT_BASE_URL}/people/match`;
      
      if (!personId) {
        return { phone: null, from_cache: false, credits_used: 0, error: 'Person ID is required for phone reveal' };
      }
      
      // CRITICAL FIX: Validate personId format
      // Apollo person IDs are numeric. If we receive a UUID format ID (likely a database record ID),
      // we should reject it and not call Apollo API
      const isUUIDFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(personId));
      if (isUUIDFormat) {
        logger.warn('[Apollo Reveal] Person ID has UUID format - likely a database ID, not an Apollo person ID', { personId });
        // Refund credits for validation error - no service provided
        await this._attemptRefund(tenantId, 'apollo_phone', CREDIT_COSTS.PHONE_REVEAL, req, 'Invalid person ID format');
        return { 
          phone: null, 
          from_cache: false, 
          credits_used: 0, 
          error: 'Invalid person ID format. Apollo expects numeric person IDs from search results.',
          validation_error: true
        };
      }
      
      // Validate personId is numeric or at least not completely invalid
      const personIdNum = Number(personId);
      if (isNaN(personIdNum) && personId && personId.length > 50) {
        logger.warn('[Apollo Reveal] Person ID format appears invalid for Apollo API', { personId, length: personId.length });
        // Refund credits for validation error - no service provided
        await this._attemptRefund(tenantId, 'apollo_phone', CREDIT_COSTS.PHONE_REVEAL, req, 'Invalid person ID format');
        return { 
          phone: null, 
          from_cache: false, 
          credits_used: 0, 
          error: 'Invalid person ID format. Expected numeric Apollo person ID.',
          validation_error: true
        };
      }
      
      const apolloRequest = {
        id: personId,
        reveal_phone_number: true,
        webhook_url: process.env.APOLLO_WEBHOOK_URL || 'https://apollo-phone-service-741719885039.us-central1.run.app/api/webhook/apollo-phone'
      };
      
      logger.debug('[Apollo Reveal] Phone reveal request', { 
        url: apolloUrl, 
        body: apolloRequest,
        personId 
      });
      
      // Apollo phone reveals are asynchronous - result comes via webhook
      const apolloResponse = await axios.post(apolloUrl, apolloRequest, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      // For phone reveals, Apollo returns success but phone comes via webhook later
      if (apolloResponse.data?.success !== false) {
        logger.info('[Apollo Reveal] Phone reveal request submitted successfully - result will come via webhook', { 
          credits_used: CREDIT_COSTS.PHONE_REVEAL 
        });
        
        return { 
          phone: null, 
          from_cache: false, 
          credits_used: CREDIT_COSTS.PHONE_REVEAL, 
          status: 'pending',
          message: 'Phone reveal request submitted. Result will be delivered via webhook.'
        };
      } else {
        logger.warn('[Apollo Reveal] Phone reveal request failed');
        return { 
          phone: null, 
          from_cache: false, 
          credits_used: 0, 
          error: 'Phone reveal request failed' 
        };
      }
    } catch (error) {
      logger.error('[Apollo Reveal] Reveal phone error', { 
        error: error.message, 
        stack: error.stack,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data
      });
      
      // CRITICAL FIX: Refund credits for client errors (4xx)
      // Client errors mean the request was malformed or invalid - no service provided
      // Only charge credits for successful requests or server errors (5xx retry)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        logger.warn('[Apollo Reveal] Refunding credits due to client error (4xx)', { 
          status: error.response?.status,
          error: error.response?.data?.message || error.message
        });
        await this._attemptRefund(tenantId, 'apollo_phone', CREDIT_COSTS.PHONE_REVEAL, req, `Apollo API error: ${error.response?.status} ${error.response?.data?.message || error.message}`);
        return { 
          phone: null, 
          from_cache: false, 
          credits_used: 0, // No charge for invalid requests
          error: `Apollo API error: ${error.response?.data?.message || error.message}`,
          apollo_status: error.response?.status
        };
      }
      
      // For server errors (5xx), don't refund - retry could succeed
      const creditsUsed = error.response?.status >= 500 ? CREDIT_COSTS.PHONE_REVEAL : 0;
      
      return { 
        phone: null, 
        from_cache: false, 
        credits_used: creditsUsed, 
        error: `${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}` 
      };
    }
  }

  /**
   * Handle webhook callback from Apollo for phone number reveal
   * Apollo sends phone numbers asynchronously
   */
  async handlePhoneRevealWebhook(webhookData) {
    try {
      logger.info('[Apollo Reveal] Processing phone reveal webhook', { 
        data: webhookData 
      });

      // Apollo webhook format: { person: { id: '...', sanitized_phone: '+1234567890', ... } }
      const personData = webhookData.person || webhookData;
      const personId = personData.id;
      const phone = personData.sanitized_phone || personData.phone;

      if (!personId || !phone) {
        logger.warn('[Apollo Reveal] Webhook missing person ID or phone', { 
          webhookData 
        });
        return { success: false, error: 'Missing person ID or phone' };
      }

      // Update employees_cache with the phone number
      const schema = process.env.POSTGRES_SCHEMA || 'lad_dev';
      await ApolloEmployeesCacheRepository.updatePhone(personId, phone, null, schema);

      logger.info('[Apollo Reveal] Phone number saved from webhook', { 
        personId, 
        phone: phone.substring(0, 5) + '***' 
      });

      return { 
        success: true, 
        personId, 
        phone 
      };
    } catch (error) {
      logger.error('[Apollo Reveal] Webhook processing error', { 
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }

  /**
   * Enrich person details - reveals email and returns full person data including LinkedIn URL
   * Used for auto-enrichment before LinkedIn steps
   * 
   * @param {string} personId - Apollo person ID
   * @param {Object} req - Request object (optional)
   * @param {Object} options - Additional options { campaignId, leadId }
   * @returns {Object} { success, person: { email, linkedin_url, ... }, credits_used }
   */
  async enrichPersonDetails(personId, req = null, options = {}) {
    const { campaignId, leadId } = options;
    try {
      // Don't require tenant for this call - it may be called from background processes
      const tenantId = req?.user?.tenant_id || req?.tenant?.id || req?.headers?.['x-tenant-id'] || null;
      
      if (!this.apiKey) {
        throw new Error('Apollo API key is not configured');
      }
      
      if (!personId) {
        return { success: false, person: null, credits_used: 0, error: 'Person ID is required' };
      }
      
      // CRITICAL FIX: Validate personId format
      const isUUIDFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(personId));
      if (isUUIDFormat) {
        logger.warn('[Apollo Reveal] Person ID has UUID format - likely a database ID', { personId });
        return { 
          success: false, 
          person: null, 
          credits_used: 0, 
          error: 'Invalid person ID format. Apollo expects numeric person IDs.'
        };
      }
      
      // Use people/match endpoint for enrichment (returns full person data)
      const apolloUrl = `${this.baseURL || APOLLO_CONFIG.DEFAULT_BASE_URL}/people/match`;
      
      const apolloRequest = {
        id: personId,
        reveal_personal_emails: true
      };
      
      logger.info('[Apollo Reveal] Enriching person details', { 
        personId,
        url: apolloUrl
      });
      
      const apolloResponse = await axios.post(apolloUrl, apolloRequest, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const person = apolloResponse.data?.person;
      
      if (!person) {
        logger.warn('[Apollo Reveal] No person data in response', { personId });
        return { 
          success: false, 
          person: null, 
          credits_used: CREDIT_COSTS.EMAIL_REVEAL, 
          error: 'Person not found' 
        };
      }
      
      // Extract the data we need - capture ALL Apollo person fields
      const enrichedPerson = {
        id: person.id,
        // Contact information
        email: person.email || person.personal_emails?.[0],
        personal_emails: person.personal_emails || [],
        phone: person.sanitized_phone || person.phone_numbers?.[0]?.sanitized_number,
        sanitized_phone: person.sanitized_phone,
        phone_numbers: person.phone_numbers || [],
        // Profile information
        linkedin_url: person.linkedin_url,
        photo_url: person.photo_url,
        name: person.name,
        first_name: person.first_name,
        last_name: person.last_name,
        title: person.title,
        headline: person.headline,
        // Location
        city: person.city,
        state: person.state,
        country: person.country,
        // Professional details
        seniority: person.seniority,
        departments: person.departments,
        functions: person.functions,
        employment_history: person.employment_history,
        education: person.education,
        // Organization - store complete organization object
        organization: person.organization,
        // Store complete person object for future use
        _apollo_full_response: person
      };
      
      logger.info('[Apollo Reveal] Person enriched successfully', { 
        personId,
        hasEmail: !!enrichedPerson.email,
        hasLinkedIn: !!enrichedPerson.linkedin_url,
        credits_used: CREDIT_COSTS.EMAIL_REVEAL
      });
      
      // Deduct credits for successful enrichment
      if (tenantId) {
        try {
          await deductCredits(tenantId, 'apollo-leads', 'person_enrichment', CREDIT_COSTS.EMAIL_REVEAL, req, {
            campaignId: campaignId,
            leadId: leadId,
            stepType: 'person_enrichment'
          });
          logger.info('[Apollo Reveal] Credits deducted for enrichment', { 
            tenantId, 
            credits: CREDIT_COSTS.EMAIL_REVEAL,
            campaignId: campaignId || 'N/A'
          });
        } catch (creditError) {
          logger.error('[Apollo Reveal] Failed to deduct credits', { 
            error: creditError.message, 
            tenantId 
          });
          // Don't fail the enrichment if credit deduction fails
        }
      } else {
        logger.warn('[Apollo Reveal] No tenantId available for credit deduction', { personId });
      }
      
      // Update cache with enriched data
      try {
        const schema = getSchema(req);
        if (enrichedPerson.email) {
          await ApolloEmployeesCacheRepository.updateEmail(personId, enrichedPerson.email, tenantId, schema);
        }
        // Note: LinkedIn URL should already be in cache from initial search
      } catch (cacheError) {
        logger.warn('[Apollo Reveal] Error updating cache', { error: cacheError.message });
      }
      
      return { 
        success: true, 
        person: enrichedPerson, 
        credits_used: CREDIT_COSTS.EMAIL_REVEAL 
      };
      
    } catch (error) {
      logger.error('[Apollo Reveal] Enrich person error', { 
        personId,
        error: error.message,
        status: error.response?.status
      });
      
      return { 
        success: false, 
        person: null, 
        credits_used: 0, 
        error: error.message 
      };
    }
  }
}

module.exports = ApolloRevealService;
