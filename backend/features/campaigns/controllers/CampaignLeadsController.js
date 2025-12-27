/**
 * Campaign Leads Controller
 * Handles lead management for campaigns
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../../core/utils/schemaHelper');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');

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
      const { pool } = require('../utils/dbConnection');

      // First, try to get leads with joined data from leads table (if it exists)
      // If that fails, fall back to just campaign_leads data
      let query = `
        SELECT 
          cl.id,
          cl.campaign_id,
          cl.lead_id,
          cl.status,
          cl.snapshot,
          cl.lead_data,
          cl.created_at,
          cl.updated_at
        const schema = getSchema(req);
        FROM ${schema}.campaign_leads cl
        WHERE cl.campaign_id = $1 AND cl.tenant_id = $2 AND cl.is_deleted = FALSE
      `;

      const params = [id, tenantId];
      let paramIndex = 3;

      if (status && status !== 'all') {
        query += ` AND cl.status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY cl.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit) || 100, parseInt(offset) || 0);

      const result = await pool.query(query, params);
      
      // Format leads for frontend
      const formattedLeads = result.rows.map(row => {
        try {
          // Parse JSONB fields safely
          let snapshot = {};
          let leadData = {};
          
          try {
            snapshot = typeof row.snapshot === 'string' 
              ? JSON.parse(row.snapshot || '{}') 
              : (row.snapshot || {});
          } catch (e) {
            console.warn('[Campaign Leads] Error parsing snapshot:', e.message);
            snapshot = {};
          }
          
          try {
            leadData = typeof row.lead_data === 'string' 
              ? JSON.parse(row.lead_data || '{}') 
              : (row.lead_data || {});
          } catch (e) {
            console.warn('[Campaign Leads] Error parsing lead_data:', e.message);
            leadData = {};
          }
          
          // Extract profile summary from lead_data if it exists
          const profileSummary = leadData.profile_summary || null;
          
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
            created_at: row.created_at,
            updated_at: row.updated_at
          };
        } catch (formatError) {
          console.error('[Campaign Leads] Error formatting lead:', formatError);
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
      console.error('[Campaign Leads] Error getting campaign leads:', error);
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
      console.error('[Campaign Leads] Error adding leads:', error);
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
      console.error('[Campaign Leads] Error getting activities:', error);
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

      // Get lead data from campaign_leads
      const leadResult = await pool.query(
        const schema = getSchema(req);
        `SELECT lead_data FROM ${schema}.campaign_leads 
         WHERE id = $1 AND campaign_id = $2 AND tenant_id = $3 AND is_deleted = FALSE`,
        [leadId, campaignId, tenantId]
      );

      if (leadResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }

      // Extract summary from lead_data
      const leadData = leadResult.rows[0].lead_data;
      const parsedLeadData = typeof leadData === 'string' ? JSON.parse(leadData) : (leadData || {});
      const summary = parsedLeadData.profile_summary || null;

      res.json({
        success: true,
        summary: summary,
        exists: !!summary
      });
    } catch (error) {
      console.error('[Campaign Leads] Error getting lead summary:', error);
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
        console.warn('[Profile Summary] Gemini AI package not available:', error.message);
      }

      if (!genAI) {
        return res.status(503).json({
          success: false,
          error: 'Gemini AI is not available. Please set GEMINI_API_KEY environment variable.'
        });
      }

      // Get lead data from database
      let lead = profileData;
      if (!lead) {
        const leadResult = await pool.query(
          `SELECT cl.*, cl.lead_data as lead_data_full
           const schema = getSchema(req);
           FROM ${schema}.campaign_leads cl
           WHERE cl.id = $1 AND cl.campaign_id = $2 AND cl.tenant_id = $3 AND cl.is_deleted = FALSE`,
          [leadId, campaignId, tenantId]
        );

        if (leadResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Lead not found'
          });
        }

        const dbLead = leadResult.rows[0];
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

      console.log('[Profile Summary] Generating summary for:', lead.name);

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();

      // Save summary to lead_data
      try {
        const leadDataResult = await pool.query(
          `SELECT lead_data FROM ${schema}.campaign_leads 
           WHERE id = $1 AND campaign_id = $2 AND tenant_id = $3 AND is_deleted = FALSE`,
          [leadId, campaignId, tenantId]
        );

        if (leadDataResult.rows.length > 0) {
          let currentLeadData = {};
          if (leadDataResult.rows[0].lead_data) {
            currentLeadData = typeof leadDataResult.rows[0].lead_data === 'string' 
              ? JSON.parse(leadDataResult.rows[0].lead_data)
              : leadDataResult.rows[0].lead_data;
          }

          currentLeadData.profile_summary = summary;
          currentLeadData.profile_summary_generated_at = new Date().toISOString();

          await pool.query(
            `UPDATE ${schema}.campaign_leads 
             SET lead_data = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND campaign_id = $3 AND tenant_id = $4 AND is_deleted = FALSE`,
            [JSON.stringify(currentLeadData), leadId, campaignId, tenantId]
          );

          console.log('[Profile Summary] Summary saved to database');
        }
      } catch (saveError) {
        console.error('[Profile Summary] Error saving summary to database:', saveError);
        // Don't fail the request if save fails
      }

      res.json({
        success: true,
        summary: summary,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Campaign Leads] Error generating lead summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate lead summary',
        details: error.message
      });
    }
  }
}

module.exports = CampaignLeadsController;

