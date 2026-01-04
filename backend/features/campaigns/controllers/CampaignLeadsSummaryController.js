/**
 * Campaign Leads Summary Controller
 * Handles lead profile summary generation
 * LAD Architecture Compliant - No SQL in controllers, uses logger
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../../core/utils/schemaHelper');
const logger = require('../../../../core/utils/logger');

class CampaignLeadsSummaryController {
  /**
   * GET /api/campaigns/:id/leads/:leadId/summary
   * Get existing profile summary for a lead
   */
  static async getLeadSummary(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;

      // LAD Architecture: Use model layer instead of direct SQL in controller
      const schema = getSchema(req);
      const leadResult = await CampaignLeadModel.getLeadData(leadId, campaignId, tenantId, schema);

      if (!leadResult) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }

      // Extract summary from lead_data
      const leadData = leadResult.lead_data;
      const parsedLeadData = typeof leadData === 'string' ? JSON.parse(leadData) : (leadData || {});
      const summary = parsedLeadData.profile_summary || null;

      res.json({
        success: true,
        summary: summary,
        exists: !!summary
      });
    } catch (error) {
      logger.error('[Campaign Leads Summary] Error getting lead summary', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get lead summary',
        details: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/leads/:leadId/summary
   * Generate profile summary for a lead
   */
  static async generateLeadSummary(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;
      const { profileData } = req.body;

      // Initialize Gemini AI
      let genAI = null;
      let GoogleGenerativeAI = null;
      try {
        GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (geminiApiKey) {
          genAI = new GoogleGenerativeAI(geminiApiKey);
        }
      } catch (error) {
        logger.warn('[Profile Summary] Gemini AI package not available', { error: error.message });
      }

      if (!genAI) {
        return res.status(503).json({
          success: false,
          error: 'Gemini AI is not available. Please set GEMINI_API_KEY environment variable.'
        });
      }

      // Get lead data from database
      // LAD Architecture: Use model layer instead of direct SQL in controller
      let lead = profileData;
      if (!lead) {
        const schema = getSchema(req);
        const dbLead = await CampaignLeadModel.getLeadById(leadId, campaignId, tenantId, schema);

        if (!dbLead) {
          return res.status(404).json({
            success: false,
            error: 'Lead not found'
          });
        }
        const leadDataFull = dbLead.lead_data_full || {};
        
        lead = {
          name: dbLead.first_name && dbLead.last_name 
            ? `${dbLead.first_name} ${dbLead.last_name}`.trim()
            : dbLead.first_name || dbLead.last_name || leadDataFull.name || leadDataFull.employee_name || 'Unknown',
          title: dbLead.title || leadDataFull.title || leadDataFull.employee_title || leadDataFull.headline || '',
          company: dbLead.company_name || leadDataFull.company_name || leadDataFull.company || '',
          email: dbLead.email || leadDataFull.email || '',
          phone: dbLead.phone || leadDataFull.phone || '',
          linkedin_url: dbLead.linkedin_url || leadDataFull.linkedin_url || leadDataFull.employee_linkedin_url || '',
          ...leadDataFull
        };
      }

      // Build profile information for Gemini
      const profileInfo = `
Name: ${lead.name || 'Unknown'}
Title: ${lead.title || lead.employee_title || lead.headline || 'Not specified'}
Company: ${lead.company || lead.company_name || 'Not specified'}
Location: ${lead.location || lead.city || lead.employee_city || 'Not specified'}
LinkedIn: ${lead.linkedin_url || lead.employee_linkedin_url || 'Not available'}
${lead.headline || lead.employee_headline ? `Headline: ${lead.headline || lead.employee_headline}` : ''}
${lead.bio || lead.summary ? `Bio/Summary: ${lead.bio || lead.summary}` : ''}
      `.trim();

      // Create prompt for Gemini
      const prompt = `Analyze the following LinkedIn profile information and create a concise, professional summary that highlights:

1. Professional background and expertise
2. Key accomplishments or notable aspects
3. Industry context and role significance
4. Potential value or relevance (if applicable)

Keep the summary professional, insightful, and concise (2-3 paragraphs maximum).

Profile Information:
${profileInfo}

Summary:`;

      logger.info('[Profile Summary] Generating summary', { leadName: lead.name });

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();

      // Save summary to lead_data
      // LAD Architecture: Use model layer instead of direct SQL in controller
      try {
        const schema = getSchema(req);
        await CampaignLeadModel.updateLeadData(leadId, campaignId, tenantId, schema, {
          profile_summary: summary,
          profile_summary_generated_at: new Date().toISOString()
        });

        logger.info('[Profile Summary] Summary saved to database', { leadId, campaignId });
      } catch (saveError) {
        logger.error('[Profile Summary] Error saving summary to database', { error: saveError.message, stack: saveError.stack });
        // Don't fail the request if save fails
      }

      res.json({
        success: true,
        summary: summary,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[Campaign Leads Summary] Error generating lead summary', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to generate lead summary',
        details: error.message
      });
    }
  }
}

module.exports = CampaignLeadsSummaryController;

