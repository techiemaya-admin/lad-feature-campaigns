const axios = require('axios');
const logger = require('../../utils/logger');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be set');
}

/**
 * Voice Channel Dispatcher
 * Handles all voice-related actions
 */
class VoiceDispatcher {
  /**
   * Execute voice action
   */
  async execute(stepType, lead, stepConfig, userId, tenantId) {
    try {
      logger.info('[VoiceDispatcher] Executing step', { stepType, leadId: lead.id });

      switch (stepType) {
        case 'voice_agent_call':
          return await this.makeVoiceCall(lead, stepConfig, userId, tenantId);

        default:
          return { success: false, error: `Unsupported voice action: ${stepType}` };
      }
    } catch (error) {
      logger.error('[VoiceDispatcher] Error', { error: error.message, stack: error.stack });
      return { success: false, error: error.message };
    }
  }

  /**
   * Make voice call using voice agent
   */
  async makeVoiceCall(lead, stepConfig, userId, tenantId) {
    try {
      const leadData = lead.lead_data || {};
      const phoneNumber = leadData.phone || leadData.mobile_phone || leadData.phone_number;

      if (!phoneNumber) {
        throw new Error('No phone number found for lead');
      }

      const voiceAgentId = stepConfig.voiceAgentId;
      const voiceContext = stepConfig.voiceContext || stepConfig.added_context || '';

      if (!voiceAgentId) {
        throw new Error('Voice agent ID is required');
      }

      // Personalize context with lead data
      const personalizedContext = this.personalizeContext(voiceContext, leadData);

      // Make API call to voice agent service
      const response = await axios.post(
        `${BACKEND_URL}/api/voice-agent/make-call`,
        {
          phone_number: phoneNumber,
          voice_agent_id: voiceAgentId,
          added_context: personalizedContext,
          lead_id: lead.id,
          campaign_id: lead.campaign_id,
          user_id: userId,
          tenant_id: tenantId
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data && response.data.success) {
        return {
          success: true,
          data: {
            callId: response.data.call_id,
            status: response.data.status
          }
        };
      } else {
        throw new Error(response.data?.message || 'Voice call failed');
      }
    } catch (error) {
      logger.error('[VoiceDispatcher] Voice call failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Personalize context with lead data
   */
  personalizeContext(template, leadData) {
    let context = template;

    // Replace placeholders
    const replacements = {
      '{{first_name}}': leadData.first_name || '',
      '{{last_name}}': leadData.last_name || '',
      '{{full_name}}': leadData.name || `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim(),
      '{{title}}': leadData.title || leadData.headline || '',
      '{{company}}': leadData.organization || leadData.company || '',
      '{{email}}': leadData.email || '',
      '{{phone}}': leadData.phone || leadData.mobile_phone || '',
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      context = context.replace(new RegExp(placeholder, 'g'), value);
    }

    return context;
  }
}

module.exports = new VoiceDispatcher();
