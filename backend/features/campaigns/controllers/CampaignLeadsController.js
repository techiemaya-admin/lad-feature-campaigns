/**
 * Campaign Leads Controller
 * Handles lead management for campaigns
 * LAD Architecture Compliant - No SQL in controllers, uses logger instead of console
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../core/utils/schemaHelper');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');
const logger = require('../../../core/utils/logger');

class CampaignLeadsController {
  /**
   * GET /api/campaigns/:id/leads
   * Get leads for a campaign
   */
  static async getCampaignLeads(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { status, limit, offset } = req.query;
      // LAD Architecture: Use model layer instead of direct SQL in controller
      const schema = getSchema(req);
      const leads = await CampaignLeadModel.getByCampaignId(id, tenantId, {
        status,
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0
      }, req);
      
      // Format leads for frontend
      const formattedLeads = leads.map(row => {
        try {
          // Parse JSONB fields safely
          let snapshot = {};
          let leadData = {};
          
          try {
            snapshot = typeof row.snapshot === 'string' 
              ? JSON.parse(row.snapshot || '{}') 
              : (row.snapshot || {});
          } catch (e) {
            logger.warn('[Campaign Leads] Error parsing snapshot', { error: e.message });
            snapshot = {};
          }
          
          try {
            leadData = typeof row.lead_data === 'string' 
              ? JSON.parse(row.lead_data || '{}') 
              : (row.lead_data || {});
          } catch (e) {
            logger.warn('[Campaign Leads] Error parsing lead_data', { error: e.message });
            leadData = {};
          }
          
          // Extract profile summary from lead_data if it exists
          const profileSummary = leadData.profile_summary || null;
          
          // Extract apollo_person_id from lead_data (needed for reveal email/phone)
          const apolloPersonId = leadData.apollo_person_id || leadData.id || leadData.apollo_id || null;
          
          // Extract name fields - Priority: snapshot > lead_data
          const firstName = snapshot.first_name || leadData.first_name || leadData.employee_name?.split(' ')[0] || '';
          const lastName = snapshot.last_name || leadData.last_name || leadData.employee_name?.split(' ').slice(1).join(' ') || '';
          
          // Build full name
          let name = '';
          if (firstName && lastName) {
            name = `${firstName} ${lastName}`.trim();
          } else if (firstName) {
            name = firstName;
          } else if (lastName) {
            name = lastName;
          } else {
            name = leadData.name || leadData.employee_name || leadData.fullname || snapshot.name || 'Unknown';
          }
          
          return {
            id: row.id,
            campaign_id: row.campaign_id,
            lead_id: row.lead_id,
            status: row.status,
            name: name,
            first_name: firstName,
            last_name: lastName,
            email: snapshot.email || leadData.email || leadData.employee_email || leadData.work_email || null,
            phone: snapshot.phone || leadData.phone || leadData.employee_phone || leadData.phone_number || null,
            company: snapshot.company_name || leadData.company_name || leadData.company || leadData.employee_company || leadData.organization?.name || null,
            title: snapshot.title || leadData.title || leadData.employee_title || leadData.job_title || leadData.headline || null,
            linkedin_url: snapshot.linkedin_url || leadData.linkedin_url || leadData.employee_linkedin_url || leadData.linkedin || null,
            photo_url: leadData.photo_url || leadData.employee_photo_url || leadData.avatar || snapshot.photo_url || null,
            profile_summary: profileSummary,
            apollo_person_id: apolloPersonId, // Include apollo_person_id for reveal functionality
            created_at: row.created_at,
            updated_at: row.updated_at
          };
        } catch (formatError) {
          logger.error('[Campaign Leads] Error formatting lead', { error: formatError.message, stack: formatError.stack });
          // Return minimal data if formatting fails
          return {
            id: row.id,
            campaign_id: row.campaign_id,
            lead_id: row.lead_id,
            status: row.status,
            name: 'Unknown',
            first_name: null,
            last_name: null,
            email: null,
            phone: null,
            company: null,
            title: null,
            linkedin_url: null,
            photo_url: null,
            profile_summary: null,
            created_at: row.created_at,
            updated_at: row.updated_at
          };
        }
      });

      res.json({
        success: true,
        data: formattedLeads
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error getting campaign leads', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign leads',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/leads
   * Add leads to campaign
   */
  static async addLeadsToCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { leads } = req.body;

      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Leads array is required'
        });
      }

      const createdLeads = await CampaignLeadModel.bulkCreate(id, tenantId, leads);

      res.status(201).json({
        success: true,
        data: createdLeads
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error adding leads', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to add leads to campaign',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id/activities
   * Get activities for a campaign
   */
  static async getCampaignActivities(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { status, stepType, limit, offset } = req.query;

      const activities = await CampaignLeadActivityModel.getByCampaignId(id, tenantId, {
        status,
        stepType,
        limit: parseInt(limit) || 1000,
        offset: parseInt(offset) || 0
      });

      res.json({
        success: true,
        data: activities
      });
    } catch (error) {
      logger.error('[Campaign Leads] Error getting activities', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign activities',
        message: error.message
      });
    }
  }

  /**
   * GET /api/campaigns/:id/leads/:leadId/summary
   * Get existing profile summary for a lead
   */
  static async getLeadSummary(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;
      const { pool } = require('../utils/dbConnection');

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
      logger.error('[Campaign Leads] Error getting lead summary', { error: error.message, stack: error.stack });
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
      const { pool } = require('../utils/dbConnection');

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
      logger.error('[Campaign Leads] Error generating lead summary', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to generate lead summary',
        details: error.message
      });
    }
  }
}

module.exports = CampaignLeadsController;

