/**
 * LinkedIn Profile Summary Service
 * Handles profile summary generation and saving
 */

const { pool } = require('../utils/dbConnection');

/**
 * Generate and save profile summary for a LinkedIn visit
 */
async function generateAndSaveProfileSummary(campaignLeadId, leadData, profileData, employee) {
  try {
    console.log(`[Profile Summary] Generating profile summary for ${employee.fullname} after visit`);
    
    // Generate summary using Gemini AI
    let summary = null;
    try {
      const GoogleGenerativeAI = require('@google/generative-ai');
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
        
        console.log(`[Profile Summary] ✅ Profile summary generated for ${employee.fullname}`);
      } else {
        console.warn(`[Profile Summary] ⚠️ GEMINI_API_KEY not set, skipping summary generation`);
      }
    } catch (geminiErr) {
      console.error('[Profile Summary] Error calling Gemini API:', geminiErr.message);
    }
    
    // Save summary to campaign_leads table (in lead_data JSONB or metadata)
    if (summary) {
      try {
        // Get current lead_data
        const leadDataQuery = await pool.query(
          `SELECT lead_data FROM campaign_leads WHERE id = $1`,
          [campaignLeadId]
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
          `UPDATE campaign_leads 
           SET lead_data = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [JSON.stringify(currentLeadData), campaignLeadId]
        );
        
        console.log(`[Profile Summary] ✅ Profile summary saved to database for ${employee.fullname}`);
      } catch (dbErr) {
        console.error('[Profile Summary] Error saving summary to database:', dbErr.message);
      }
    }
    
    return summary;
  } catch (summaryErr) {
    // Don't fail the visit step if summary generation fails
    console.error('[Profile Summary] Error generating profile summary after visit:', summaryErr);
    return null;
  }
}

module.exports = {
  generateAndSaveProfileSummary
};

