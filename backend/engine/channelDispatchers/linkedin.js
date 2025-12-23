const unipileService = require('../services/unipileService');

/**
 * LinkedIn Channel Dispatcher
 * Handles all LinkedIn-related actions
 */
class LinkedInDispatcher {
  /**
   * Execute LinkedIn action
   */
  async execute(stepType, lead, stepConfig, userId, orgId) {
    try {
      console.log(`[LinkedInDispatcher] Executing ${stepType} for lead ${lead.id}`);

      switch (stepType) {
        case 'linkedin_connect':
          return await this.sendConnectionRequest(lead, stepConfig, userId);

        case 'linkedin_message':
          return await this.sendMessage(lead, stepConfig, userId);

        case 'linkedin_visit':
          return await this.visitProfile(lead, userId);

        case 'linkedin_follow':
          return await this.followProfile(lead, userId);

        default:
          return { success: false, error: `Unsupported LinkedIn action: ${stepType}` };
      }
    } catch (error) {
      console.error('[LinkedInDispatcher] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send LinkedIn connection request
   */
  async sendConnectionRequest(lead, stepConfig, userId) {
    try {
      const leadData = lead.lead_data || {};
      const linkedinUrl = leadData.linkedin_url || leadData.linkedin_profile_url;

      if (!linkedinUrl) {
        throw new Error('No LinkedIn URL found for lead');
      }

      // Optional message (LinkedIn limits connection messages)
      const message = stepConfig.message || '';

      const result = await unipileService.sendConnectionRequest(
        userId,
        linkedinUrl,
        message
      );

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[LinkedInDispatcher] Connection request failed:', error);
      throw error;
    }
  }

  /**
   * Send LinkedIn message
   */
  async sendMessage(lead, stepConfig, userId) {
    try {
      const leadData = lead.lead_data || {};
      const linkedinUrl = leadData.linkedin_url || leadData.linkedin_profile_url;

      if (!linkedinUrl) {
        throw new Error('No LinkedIn URL found for lead');
      }

      const message = this.personalizeMessage(stepConfig.message, leadData);

      const result = await unipileService.sendMessage(
        userId,
        linkedinUrl,
        message
      );

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[LinkedInDispatcher] Message send failed:', error);
      throw error;
    }
  }

  /**
   * Visit LinkedIn profile
   */
  async visitProfile(lead, userId) {
    try {
      const leadData = lead.lead_data || {};
      const linkedinUrl = leadData.linkedin_url || leadData.linkedin_profile_url;

      if (!linkedinUrl) {
        throw new Error('No LinkedIn URL found for lead');
      }

      const result = await unipileService.visitProfile(userId, linkedinUrl);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[LinkedInDispatcher] Profile visit failed:', error);
      throw error;
    }
  }

  /**
   * Follow LinkedIn profile
   */
  async followProfile(lead, userId) {
    try {
      const leadData = lead.lead_data || {};
      const linkedinUrl = leadData.linkedin_url || leadData.linkedin_profile_url;

      if (!linkedinUrl) {
        throw new Error('No LinkedIn URL found for lead');
      }

      const result = await unipileService.followProfile(userId, linkedinUrl);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[LinkedInDispatcher] Follow failed:', error);
      throw error;
    }
  }

  /**
   * Personalize message with lead data
   */
  personalizeMessage(template, leadData) {
    let message = template;

    // Replace placeholders
    const replacements = {
      '{{first_name}}': leadData.first_name || '',
      '{{last_name}}': leadData.last_name || '',
      '{{full_name}}': leadData.name || `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim(),
      '{{title}}': leadData.title || leadData.headline || '',
      '{{company}}': leadData.organization || leadData.company || '',
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      message = message.replace(new RegExp(placeholder, 'g'), value);
    }

    return message;
  }
}

module.exports = new LinkedInDispatcher();
