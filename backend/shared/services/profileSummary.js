const express = require('express');
const router = express.Router();
const { pool } = require('../database/connection');

// Initialize Gemini AI
let genAI = null;
let GoogleGenerativeAI = null;

try {
  GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error('❌ GEMINI_API_KEY environment variable is not set!');
    genAI = null;
  } else {
    genAI = new GoogleGenerativeAI(geminiApiKey);
    console.log('✅ Gemini AI initialized for profile summaries');
  }
} catch (error) {
  console.log('⚠️ Gemini AI package not found for profile summaries');
  genAI = null;
}

/**
 * POST /api/profile-summary/generate
 * Generate a profile summary using Gemini AI based on lead/profile data
 */
router.post('/generate', async (req, res) => {
  try {
    const { leadId, campaignId, profileData } = req.body;

    if (!leadId && !profileData) {
      return res.status(400).json({
        success: false,
        error: 'Either leadId or profileData is required'
      });
    }

    let lead = profileData;

    // If leadId is provided, fetch lead data from database
    if (leadId && campaignId) {
      try {
        // First check if lead_data column exists
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'campaign_leads' AND column_name = 'lead_data'
        `);
        
        const hasLeadDataColumn = columnCheck.rows.length > 0;
        
        // Build query based on which column exists
        let leadResult;
        if (hasLeadDataColumn) {
          leadResult = await pool.query(
            `SELECT cl.*, cl.lead_data as lead_data_full
             FROM campaign_leads cl
             WHERE cl.id = $1 AND cl.campaign_id = $2`,
            [leadId, campaignId]
          );
        } else {
          leadResult = await pool.query(
            `SELECT cl.*, cl.custom_fields as lead_data_full
             FROM campaign_leads cl
             WHERE cl.id = $1 AND cl.campaign_id = $2`,
            [leadId, campaignId]
          );
        }

        if (leadResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Lead not found'
          });
        }

        const dbLead = leadResult.rows[0];
        const leadData = dbLead.lead_data_full || {};

        lead = {
          name: dbLead.first_name && dbLead.last_name 
            ? `${dbLead.first_name} ${dbLead.last_name}`.trim()
            : dbLead.first_name || dbLead.last_name || leadData.name || leadData.employee_name || 'Unknown',
          title: dbLead.title || leadData.title || leadData.employee_title || leadData.headline || '',
          company: dbLead.company_name || leadData.company_name || leadData.company || '',
          email: dbLead.email || leadData.email || '',
          phone: dbLead.phone || leadData.phone || '',
          linkedin_url: dbLead.linkedin_url || leadData.linkedin_url || leadData.employee_linkedin_url || '',
          ...leadData
        };
      } catch (dbError) {
        console.error('[Profile Summary] Error fetching lead from database:', dbError);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch lead data',
          details: dbError.message
        });
      }
    }

    if (!genAI) {
      return res.status(503).json({
        success: false,
        error: 'Gemini AI is not available. Please set GEMINI_API_KEY environment variable.'
      });
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

    // Optionally store the summary in the database
    if (leadId && campaignId) {
      try {
        // Check if profile_summary column exists, if not, store in custom_fields
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'campaign_leads' AND column_name = 'profile_summary'
        `);

        if (columnCheck.rows.length > 0) {
          await pool.query(
            `UPDATE campaign_leads 
             SET profile_summary = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND campaign_id = $3`,
            [summary, leadId, campaignId]
          );
        } else {
          // Store in custom_fields as fallback
          const customFieldsResult = await pool.query(
            `SELECT custom_fields FROM campaign_leads WHERE id = $1 AND campaign_id = $2`,
            [leadId, campaignId]
          );
          
          let customFields = {};
          if (customFieldsResult.rows.length > 0 && customFieldsResult.rows[0].custom_fields) {
            customFields = typeof customFieldsResult.rows[0].custom_fields === 'string'
              ? JSON.parse(customFieldsResult.rows[0].custom_fields)
              : customFieldsResult.rows[0].custom_fields;
          }
          
          customFields.profile_summary = summary;
          
          await pool.query(
            `UPDATE campaign_leads 
             SET custom_fields = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND campaign_id = $3`,
            [JSON.stringify(customFields), leadId, campaignId]
          );
        }
        console.log('[Profile Summary] Summary saved to database');
      } catch (saveError) {
        console.error('[Profile Summary] Error saving summary to database:', saveError);
        // Don't fail the request if save fails
      }
    }

    res.json({
      success: true,
      summary: summary,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('[Profile Summary] Error generating advanced summary', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to generate profile summary',
      details: error.message
    });
  }
});

/**
 * GET /api/profile-summary/:leadId
 * Get existing profile summary for a lead
 */
router.get('/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'campaignId query parameter is required'
      });
    }

    // Check if profile_summary column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'campaign_leads' AND column_name = 'profile_summary'
    `);

    let summary = null;

    if (columnCheck.rows.length > 0) {
      const result = await pool.query(
        `SELECT profile_summary FROM campaign_leads WHERE id = $1 AND campaign_id = $2`,
        [leadId, campaignId]
      );
      summary = result.rows.length > 0 ? result.rows[0].profile_summary : null;
    } else {
      // Check in custom_fields
      const result = await pool.query(
        `SELECT custom_fields FROM campaign_leads WHERE id = $1 AND campaign_id = $2`,
        [leadId, campaignId]
      );
      
      if (result.rows.length > 0 && result.rows[0].custom_fields) {
        const customFields = typeof result.rows[0].custom_fields === 'string'
          ? JSON.parse(result.rows[0].custom_fields)
          : result.rows[0].custom_fields;
        summary = customFields.profile_summary || null;
      }
    }

    res.json({
      success: true,
      summary: summary,
      exists: !!summary
    });

  } catch (error) {
    console.error('[Profile Summary] Error fetching summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile summary',
      details: error.message
    });
  }
});

/**
 * Helper function to generate profile summary (can be imported by other modules)
 * @param {Object} lead - Lead data object
 * @param {string} leadId - Optional lead ID
 * @param {string} campaignId - Optional campaign ID
 * @returns {Promise<{success: boolean, summary?: string, error?: string}>}
 */
async function generateProfileSummary(lead, leadId = null, campaignId = null) {
  try {
    if (!genAI) {
      return {
        success: false,
        error: 'Gemini AI is not available. Please set GEMINI_API_KEY environment variable.'
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

    // Store the summary in the database if leadId and campaignId are provided
    if (leadId && campaignId) {
      try {
        // Check if profile_summary column exists, if not, store in custom_fields
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'campaign_leads' AND column_name = 'profile_summary'
        `);

        if (columnCheck.rows.length > 0) {
          await pool.query(
            `UPDATE campaign_leads 
             SET profile_summary = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND campaign_id = $3`,
            [summary, leadId, campaignId]
          );
        } else {
          // Store in custom_fields as fallback
          const customFieldsResult = await pool.query(
            `SELECT custom_fields FROM campaign_leads WHERE id = $1 AND campaign_id = $2`,
            [leadId, campaignId]
          );
          
          let customFields = {};
          if (customFieldsResult.rows.length > 0 && customFieldsResult.rows[0].custom_fields) {
            customFields = typeof customFieldsResult.rows[0].custom_fields === 'string'
              ? JSON.parse(customFieldsResult.rows[0].custom_fields)
              : customFieldsResult.rows[0].custom_fields;
          }
          
          customFields.profile_summary = summary;
          
          await pool.query(
            `UPDATE campaign_leads 
             SET custom_fields = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND campaign_id = $3`,
            [JSON.stringify(customFields), leadId, campaignId]
          );
        }
        console.log('[Profile Summary] Summary saved to database');
      } catch (saveError) {
        console.error('[Profile Summary] Error saving summary to database:', saveError);
        // Don't fail if save fails, still return the summary
      }
    }

    return {
      success: true,
      summary: summary
    };
  } catch (error) {
    logger.error('[Profile Summary] Error generating summary', { error: error.message, stack: error.stack });
    return {
      success: false,
      error: error.message || 'Failed to generate profile summary'
    };
  }
}

// Export router as default, and also export the helper function
module.exports = router;
module.exports.generateProfileSummary = generateProfileSummary;

