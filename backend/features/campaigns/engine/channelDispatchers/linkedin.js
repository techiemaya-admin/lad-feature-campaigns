const unipileService = require('../services/unipileService');
const { pool } = require('../../../../../shared/database/connection');

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
      const leadData = typeof lead.lead_data === 'string' 
        ? JSON.parse(lead.lead_data) 
        : (lead.lead_data || {});
      const linkedinUrl = leadData.linkedin_url || leadData.linkedin_profile_url;

      if (!linkedinUrl) {
        throw new Error('No LinkedIn URL found for lead');
      }

      // Get LinkedIn account ID for the user
      let linkedinAccountId = null;
      try {
        const accountQuery = await pool.query(
          `SELECT unipile_account_id FROM linkedin_integrations 
           WHERE user_id = $1 AND is_active = TRUE 
           ORDER BY connected_at DESC NULLS LAST 
           LIMIT 1`,
          [userId]
        );
        if (accountQuery.rows.length > 0) {
          linkedinAccountId = accountQuery.rows[0].unipile_account_id;
        }
      } catch (accountErr) {
        console.warn('[LinkedInDispatcher] Could not get LinkedIn account ID:', accountErr.message);
      }

      // Visit profile and get contact details
      let result;
      if (linkedinAccountId) {
        // Use getLinkedInContactDetails to fetch full profile data
        result = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
      } else {
        // Fallback to simple visit
        result = await unipileService.visitProfile(userId, linkedinUrl);
      }

      // After successful visit, generate and save summary
      if (result && result.success !== false) {
        try {
          const profileData = result.profile || result;
          
          // Generate summary using Gemini AI
          let summary = null;
          try {
            const GoogleGenerativeAI = require('@google/generative-ai');
            const geminiApiKey = process.env.GEMINI_API_KEY;
            
            if (geminiApiKey) {
              const genAI = new GoogleGenerativeAI(geminiApiKey);
              const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
              
              const name = leadData.name || leadData.first_name || leadData.employee_name || 'Unknown';
              const title = leadData.title || leadData.employee_title || profileData.headline || profileData.title || 'Not specified';
              const company = leadData.company_name || leadData.company || profileData.company || 'Not specified';
              const location = leadData.location || leadData.city || leadData.employee_city || profileData.location || 'Not specified';
              const headline = profileData.headline || leadData.headline || leadData.employee_headline || 'Not specified';
              const bio = profileData.summary || profileData.bio || leadData.bio || leadData.summary || 'Not specified';
              
              const prompt = `Generate a professional 2-3 sentence summary for this LinkedIn profile:

Name: ${name}
Title: ${title}
Company: ${company}
Location: ${location}
Headline: ${headline}
Bio/Summary: ${bio}

Generate a concise, professional summary highlighting their role, expertise, and key characteristics. Focus on what makes them a valuable prospect.`;

              const geminiResult = await model.generateContent(prompt);
              const response = await geminiResult.response;
              summary = response.text().trim();
              
              console.log(`[LinkedInDispatcher] ✅ Profile summary generated for ${name}`);
            } else {
              console.warn(`[LinkedInDispatcher] ⚠️ GEMINI_API_KEY not set, skipping summary generation`);
            }
          } catch (geminiErr) {
            console.error('[LinkedInDispatcher] Error calling Gemini API:', geminiErr.message);
          }
          
          // Per TDD: Use lad_dev schema - Save summary to campaign_leads table
          if (summary && lead.id) {
            try {
              // Get current lead_data
              const leadDataQuery = await pool.query(
                `SELECT lead_data FROM lad_dev.campaign_leads WHERE id = $1 AND is_deleted = FALSE`,
                [lead.id]
              );
              
              let currentLeadData = {};
              if (leadDataQuery.rows.length > 0 && leadDataQuery.rows[0].lead_data) {
                currentLeadData = typeof leadDataQuery.rows[0].lead_data === 'string' 
                  ? JSON.parse(leadDataQuery.rows[0].lead_data)
                  : leadDataQuery.rows[0].lead_data;
              }
              
              // Add summary to lead_data
              currentLeadData.profile_summary = summary;
              currentLeadData.profile_summary_generated_at = new Date().toISOString();
              
              // Update campaign_leads with summary
              await pool.query(
                `UPDATE lad_dev.campaign_leads 
                 SET lead_data = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2 AND is_deleted = FALSE`,
                [JSON.stringify(currentLeadData), lead.id]
              );
              
              console.log(`[LinkedInDispatcher] ✅ Profile summary saved to database for lead ${lead.id}`);
            } catch (dbErr) {
              console.error('[LinkedInDispatcher] Error saving summary to database:', dbErr.message);
            }
          }
        } catch (summaryErr) {
          // Don't fail the visit if summary generation fails
          console.error('[LinkedInDispatcher] Error generating profile summary:', summaryErr.message);
        }
      }

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
