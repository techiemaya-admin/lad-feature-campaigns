/**
 * Voice Agent Client
 * 
 * Internal client for triggering voice calls from the voice-agent feature
 * Used by follow-up call system and other internal services
 * Multi-tenant safe with proper header and context passing
 */

const axios = require('axios');

let logger;
try {
  logger = require('../../core/utils/logger');
} catch (e) {
  logger = {
    info: (...args) => console.log('[VoiceAgentClient INFO]', ...args),
    error: (...args) => console.error('[VoiceAgentClient ERROR]', ...args),
    warn: (...args) => console.warn('[VoiceAgentClient WARN]', ...args)
  };
}

class VoiceAgentClient {
  constructor() {
    // External voice agent service (voag.techiemaya.com)
    this.baseUrl = process.env.BASE_URL || process.env.VOICE_AGENT_BASE_URL || 'http://localhost:3000';
    this.frontendHeader = process.env.BASE_URL_FRONTEND_HEADER || 'settings';
    this.apiKey = process.env.BASE_URL_FRONTEND_APIKEY || '';
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Start a voice call
   * 
   * @param {Object} params - Call parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.leadId - Lead ID
   * @param {string} params.bookingId - Booking ID (optional, for context)
   * @param {string} params.agentId - Voice agent ID
   * @param {string} params.phoneNumber - Recipient phone number
   * @param {string} params.leadName - Lead name
   * @param {string} params.initiatedByUserId - User ID who initiated the call
   * @param {string} params.fromNumberId - From number ID (optional)
   * @param {string} params.addedContext - Additional context for the call (optional)
   * @returns {Promise<Object>} Call result
   */
  async startCall({
    tenantId,
    leadId,
    bookingId = null,
    agentId,
    phoneNumber,
    leadName,
    initiatedByUserId,
    fromNumberId = null,
    addedContext = ''
  }) {
    if (!tenantId || !leadId || !agentId || !phoneNumber) {
      throw new Error('tenantId, leadId, agentId, and phoneNumber are required');
    }

    // Call external voice agent service directly (voag.techiemaya.com)
    const url = `${this.baseUrl}/calls/start-call`;

    // Build payload matching voice agent API V2 structure
    const payload = {
      voice_id: "default",                  // Use default voice (required by V2 API)
      to_number: phoneNumber,               // Must be E.164 format
      from_number: fromNumberId || null,
      lead_name: leadName || null,
      lead_id: leadId,
      agent_id: parseInt(agentId, 10),      // Must be integer
      added_context: addedContext || null,
      initiated_by: initiatedByUserId,
      tenant_id: tenantId,
      // Optional fields can be added here
      llm_provider: null,
      llm_model: null,
      knowledge_base_store_ids: null
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Frontend-ID': this.frontendHeader,
      'X-API-Key': this.apiKey
    };

    try {
      logger.info('Starting voice call via internal client:', {
        tenantId,
        leadId,
        bookingId,
        agentId,
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      const response = await axios.post(url, payload, {
        headers,
        timeout: this.timeout
      });

      logger.info('Voice call started successfully:', {
        tenantId,
        leadId,
        bookingId,
        callId: response.data?.callId,
        success: response.data?.success
      });

      return {
        success: true,
        callId: response.data?.callId,
        data: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;
      const statusCode = error.response?.status;

      logger.error('Voice call initiation failed:', {
        tenantId,
        leadId,
        bookingId,
        error: errorMessage,
        statusCode,
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: errorMessage,
        statusCode,
        details: error.response?.data
      };
    }
  }

  /**
   * Get call status
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} callId - Call ID
   * @returns {Promise<Object>} Call status
   */
  async getCallStatus(tenantId, callId) {
    if (!tenantId || !callId) {
      throw new Error('tenantId and callId are required');
    }

    const url = `${this.baseUrl}/api/voice-agent/calls/${callId}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId
    };

    if (this.internalSecret) {
      headers['X-Internal-Secret'] = this.internalSecret;
    }

    try {
      const response = await axios.get(url, {
        headers,
        timeout: this.timeout
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;

      logger.error('Get call status failed:', {
        tenantId,
        callId,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage,
        details: error.response?.data
      };
    }
  }

  /**
   * Mask phone number for logging (privacy)
   * 
   * @param {string} phoneNumber - Phone number
   * @returns {string} Masked phone number
   */
  maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 4) {
      return '***';
    }
    return `***${phoneNumber.slice(-4)}`;
  }

  /**
   * Set base URL (useful for testing)
   * 
   * @param {string} url - Base URL
   */
  setBaseUrl(url) {
    this.baseUrl = url;
  }

  /**
   * Check if voice agent service is available
   * 
   * @returns {Promise<boolean>} True if available
   */
  async healthCheck() {
    try {
      const url = `${this.baseUrl}/health`;
      const response = await axios.get(url, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      logger.warn('Voice agent health check failed:', error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new VoiceAgentClient();
