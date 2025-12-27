const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be set');
}

/**
 * Email Channel Dispatcher
 * Handles all email-related actions
 */
class EmailDispatcher {
  /**
   * Execute email action
   */
  async execute(stepType, lead, stepConfig, userId, orgId) {
    try {
      console.log(`[EmailDispatcher] Executing ${stepType} for lead ${lead.id}`);

      switch (stepType) {
        case 'email_send':
          return await this.sendEmail(lead, stepConfig, userId, orgId);

        case 'email_followup':
          return await this.sendFollowupEmail(lead, stepConfig, userId, orgId);

        default:
          return { success: false, error: `Unsupported email action: ${stepType}` };
      }
    } catch (error) {
      console.error('[EmailDispatcher] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email
   */
  async sendEmail(lead, stepConfig, userId, orgId) {
    try {
      const leadData = lead.lead_data || {};
      const email = leadData.email || leadData.email_address;

      if (!email) {
        throw new Error('No email address found for lead');
      }

      const subject = this.personalizeContent(stepConfig.subject, leadData);
      const body = this.personalizeContent(stepConfig.body, leadData);

      // Make API call to email service
      const response = await axios.post(
        `${BACKEND_URL}/api/email/send`,
        {
          to: email,
          subject: subject,
          body: body,
          lead_id: lead.id,
          campaign_id: lead.campaign_id,
          user_id: userId,
          org_id: orgId
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
            emailId: response.data.email_id,
            status: response.data.status
          }
        };
      } else {
        throw new Error(response.data?.message || 'Email send failed');
      }
    } catch (error) {
      console.error('[EmailDispatcher] Email send failed:', error);
      throw error;
    }
  }

  /**
   * Send followup email
   */
  async sendFollowupEmail(lead, stepConfig, userId, orgId) {
    try {
      const leadData = lead.lead_data || {};
      const email = leadData.email || leadData.email_address;

      if (!email) {
        throw new Error('No email address found for lead');
      }

      const subject = this.personalizeContent(stepConfig.subject, leadData);
      const body = this.personalizeContent(stepConfig.body, leadData);

      // Make API call to email service with followup flag
      const response = await axios.post(
        `${BACKEND_URL}/api/email/send`,
        {
          to: email,
          subject: subject,
          body: body,
          is_followup: true,
          lead_id: lead.id,
          campaign_id: lead.campaign_id,
          user_id: userId,
          org_id: orgId
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
            emailId: response.data.email_id,
            status: response.data.status
          }
        };
      } else {
        throw new Error(response.data?.message || 'Followup email send failed');
      }
    } catch (error) {
      console.error('[EmailDispatcher] Followup email send failed:', error);
      throw error;
    }
  }

  /**
   * Personalize email content with lead data
   */
  personalizeContent(template, leadData) {
    let content = template;

    // Replace placeholders
    const replacements = {
      '{{first_name}}': leadData.first_name || '',
      '{{last_name}}': leadData.last_name || '',
      '{{full_name}}': leadData.name || `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim(),
      '{{title}}': leadData.title || leadData.headline || '',
      '{{company}}': leadData.organization || leadData.company || '',
      '{{email}}': leadData.email || '',
      '{{phone}}': leadData.phone || leadData.mobile_phone || '',
      '{{industry}}': leadData.industry || '',
      '{{location}}': leadData.city || leadData.state || leadData.country || '',
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      content = content.replace(new RegExp(placeholder, 'g'), value);
    }

    return content;
  }
}

module.exports = new EmailDispatcher();
