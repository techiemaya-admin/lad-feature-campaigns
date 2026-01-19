/**
 * LinkedIn Profile Summary Service
 * Handles profile summary generation and saving
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

/**
 * Generate and save profile summary for a LinkedIn visit
 */
async function generateAndSaveProfileSummary(campaignLeadId, leadData, profileData, employee) {
  try {
    const schema = getSchema();
    logger.info('[Profile Summary] Generating profile summary', { employeeName: employee.fullname, leadId: campaignLeadId });
    
    // Generate summary using Gemini AI
    let summary = null;
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const geminiApiKey = process.env.GEMINI_API_KEY;
      
      if (geminiApiKey) {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        
        const prompt = `Generate a professional 2-3 sentence summary for this LinkedIn profile:

Name: ${leadData.name || leadData.employee_name || employee.fullname || 'Unknown'}
Title: ${leadData.title || leadData.employee_title || profileData.headline || profileData.title || 'Not specified'}
Company: ${leadData.company_name || leadData.company || profileData.company || 'Not specified'}
Location: ${leadData.location || leadData.city || leadData.employee_city || profileData.location || 'Not specified'}
Headline: ${profileData.headline || leadData.headline || leadData.employee_headline || 'Not specified'}
Bio/Summary: ${profileData.summary || profileData.bio || leadData.bio || leadData.summary || 'Not specified'}

Generate a concise, professional summary highlighting their role, expertise, and key characteristics. Focus on what makes them a valuable prospect.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        summary = response.text().trim();
        
        logger.info('[Profile Summary] Profile summary generated', { employeeName: employee.fullname });
      } else {
        logger.warn('[Profile Summary] GEMINI_API_KEY not set, skipping summary generation');
      }
    } catch (geminiErr) {
      logger.error('[Profile Summary] Error calling Gemini API', { error: geminiErr.message, stack: geminiErr.stack });
    }
    
    // Save summary to campaign_leads table (in lead_data JSONB or metadata)
    if (summary) {
      try {
        // Get tenant_id first for security
        const tenantCheck = await pool.query(
          `SELECT tenant_id FROM ${schema}.campaign_leads WHERE id = $1`,
          [campaignLeadId]
        );
        
        if (tenantCheck.rows.length === 0) {
          throw new Error('Campaign lead not found');
        }
        
        const leadTenantId = tenantCheck.rows[0].tenant_id;
        
        // Get current lead_data with tenant enforcement
        const leadDataQuery = await pool.query(
          `SELECT lead_data FROM ${schema}.campaign_leads WHERE id = $1 AND tenant_id = $2`,
          [campaignLeadId, leadTenantId]
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
          `UPDATE ${schema}.campaign_leads 
           SET lead_data = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [JSON.stringify(currentLeadData), campaignLeadId]
        );
        
        logger.info('[Profile Summary] Profile summary saved to database', { employeeName: employee.fullname, leadId: campaignLeadId });
      } catch (dbErr) {
        logger.error('[Profile Summary] Error saving summary to database', { error: dbErr.message, stack: dbErr.stack });
      }
    }
    
    return summary;
  } catch (summaryErr) {
    // Don't fail the visit step if summary generation fails
    logger.error('[Profile Summary] Error generating profile summary after visit', { error: summaryErr.message, stack: summaryErr.stack });
    return null;
  }
}

module.exports = {
  generateAndSaveProfileSummary
};

