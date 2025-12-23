/**
 * LinkedIn Step Executor
 * Handles all LinkedIn-related step executions
 */

const { pool } = require('../../../shared/database/connection');
const unipileService = require('./unipileService');
const { getLeadData } = require('./StepExecutors');

/**
 * Execute LinkedIn step
 */
async function executeLinkedInStep(stepType, stepConfig, campaignLead, userId, orgId) {
  try {
    console.log(`[Campaign Execution] Executing LinkedIn step: ${stepType}`);
    console.log(`[Campaign Execution] Campaign Lead ID: ${campaignLead?.id}, User ID: ${userId}, Org ID: ${orgId}`);
    
    // Get lead data
    const leadData = await getLeadData(campaignLead.id);
    if (!leadData) {
      console.error(`[Campaign Execution] ❌ Lead data not found for lead ID: ${campaignLead.id}`);
      return { success: false, error: 'Lead not found' };
    }
    
    const linkedinUrl = leadData.linkedin_url || leadData.employee_linkedin_url;
    if (!linkedinUrl) {
      console.error(`[Campaign Execution] ❌ LinkedIn URL not found for lead ${campaignLead.id}. Lead data keys:`, Object.keys(leadData));
      return { success: false, error: 'LinkedIn URL not found for lead' };
    }
    
    console.log(`[Campaign Execution] Found LinkedIn URL: ${linkedinUrl} for lead ${campaignLead.id}`);
    
    // Get LinkedIn account with Unipile account ID
    // Strategy 1: Try linkedin_accounts table by organization_id
    let accountResult = await pool.query(
      `SELECT id, unipile_account_id FROM linkedin_accounts 
       WHERE organization_id = $1 
       AND is_active = TRUE
       AND unipile_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    
    console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in linkedin_accounts for org ${orgId}`);
    
    // Strategy 2: If not found, try user_integrations_voiceagent by user_id
    // Note: user_id might be integer or UUID, and unipile_account_id is in credentials JSONB
    if (accountResult.rows.length === 0 && userId) {
      console.log(`[Campaign Execution] No account in linkedin_accounts, checking user_integrations_voiceagent for user ${userId}...`);
      try {
        // Try with user_id as text (for UUID) or integer, check multiple credential field names
        accountResult = await pool.query(
          `SELECT id::text as id, 
                  COALESCE(
                    NULLIF(credentials->>'unipile_account_id', ''),
                    NULLIF(credentials->>'account_id', ''),
                    NULLIF(credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent 
           WHERE provider = 'linkedin'
           AND (user_id::text = $1 OR user_id = $1::integer)
           AND is_connected = TRUE
           AND (
             (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
             OR
             (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
             OR
             (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`,
          [userId]
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for user ${userId}`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent:`, err.message);
      }
    }
    
    // Strategy 3: If still not found, try user_integrations_voiceagent by organization_id (via users_voiceagent join)
    if (accountResult.rows.length === 0 && orgId) {
      console.log(`[Campaign Execution] No account found for user, checking user_integrations_voiceagent for org ${orgId}...`);
      try {
        accountResult = await pool.query(
          `SELECT uiv.id::text as id, 
                  COALESCE(
                    NULLIF(uiv.credentials->>'unipile_account_id', ''),
                    NULLIF(uiv.credentials->>'account_id', ''),
                    NULLIF(uiv.credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent uiv
           JOIN voice_agent.users_voiceagent uva ON uiv.user_id = uva.user_id
           WHERE uiv.provider = 'linkedin'
           AND uva.organization_id = $1::uuid
           AND uiv.is_connected = TRUE
           AND (
             (uiv.credentials->>'unipile_account_id' IS NOT NULL AND uiv.credentials->>'unipile_account_id' != '' AND uiv.credentials->>'unipile_account_id' != 'null')
             OR
             (uiv.credentials->>'account_id' IS NOT NULL AND uiv.credentials->>'account_id' != '' AND uiv.credentials->>'account_id' != 'null')
             OR
             (uiv.credentials->>'unipileAccountId' IS NOT NULL AND uiv.credentials->>'unipileAccountId' != '' AND uiv.credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY uiv.connected_at DESC NULLS LAST, uiv.created_at DESC LIMIT 1`,
          [orgId]
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} LinkedIn account(s) in user_integrations_voiceagent for org ${orgId}`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent by org:`, err.message);
      }
    }
    
    // Strategy 4: If still not found, try any active account in linkedin_accounts
    if (accountResult.rows.length === 0) {
      console.log(`[Campaign Execution] No account found for org/user, searching for any active account in linkedin_accounts...`);
      accountResult = await pool.query(
        `SELECT id, unipile_account_id FROM linkedin_accounts 
         WHERE is_active = TRUE
         AND unipile_account_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      console.log(`[Campaign Execution] Found ${accountResult.rows.length} active LinkedIn account(s) globally in linkedin_accounts`);
    }
    
    // Strategy 5: Last resort - try any active account in user_integrations_voiceagent
    if (accountResult.rows.length === 0) {
      console.log(`[Campaign Execution] No account in linkedin_accounts, searching for any active account in user_integrations_voiceagent...`);
      try {
        accountResult = await pool.query(
          `SELECT id::text as id, 
                  COALESCE(
                    NULLIF(credentials->>'unipile_account_id', ''),
                    NULLIF(credentials->>'account_id', ''),
                    NULLIF(credentials->>'unipileAccountId', '')
                  ) as unipile_account_id 
           FROM voice_agent.user_integrations_voiceagent 
           WHERE provider = 'linkedin'
           AND is_connected = TRUE
           AND (
             (credentials->>'unipile_account_id' IS NOT NULL AND credentials->>'unipile_account_id' != '' AND credentials->>'unipile_account_id' != 'null')
             OR
             (credentials->>'account_id' IS NOT NULL AND credentials->>'account_id' != '' AND credentials->>'account_id' != 'null')
             OR
             (credentials->>'unipileAccountId' IS NOT NULL AND credentials->>'unipileAccountId' != '' AND credentials->>'unipileAccountId' != 'null')
           )
           ORDER BY connected_at DESC NULLS LAST, created_at DESC LIMIT 1`
        );
        console.log(`[Campaign Execution] Found ${accountResult.rows.length} active LinkedIn account(s) globally in user_integrations_voiceagent`);
      } catch (err) {
        console.log(`[Campaign Execution] Error querying user_integrations_voiceagent globally:`, err.message);
      }
    }
    
    if (accountResult.rows.length === 0) {
      console.error(`[Campaign Execution] ❌ No active LinkedIn account connected with Unipile. Org ID: ${orgId}`);
      console.error(`[Campaign Execution] To fix this: Go to Settings → LinkedIn Integration and connect a LinkedIn account`);
      return { 
        success: false, 
        error: 'No active LinkedIn account connected with Unipile. Please connect a LinkedIn account in Settings → LinkedIn Integration to enable LinkedIn campaign steps.',
        userAction: 'Connect LinkedIn account in Settings'
      };
    }
    
    const linkedinAccountId = accountResult.rows[0].unipile_account_id;
    
    if (!linkedinAccountId) {
      console.error(`[Campaign Execution] ❌ LinkedIn account found but unipile_account_id is null. Account ID: ${accountResult.rows[0].id}`);
      return { success: false, error: 'LinkedIn account does not have Unipile account ID configured' };
    }
    
    console.log(`[Campaign Execution] Using LinkedIn account with Unipile ID: ${linkedinAccountId}`);
    
    // Format employee for Unipile
    const employee = {
      profile_url: linkedinUrl,
      fullname: leadData.name || leadData.employee_name || 'Unknown',
      first_name: (leadData.name || leadData.employee_name || 'Unknown').split(' ')[0],
      last_name: (leadData.name || leadData.employee_name || 'Unknown').split(' ').slice(1).join(' '),
      public_identifier: linkedinUrl?.match(/linkedin\.com\/in\/([^\/\?]+)/)?.[1]
    };
    
    let result;
    
    // Handle all LinkedIn step types dynamically
    if (stepType === 'linkedin_connect') {
      // LinkedIn allows unlimited connection requests WITHOUT messages
      // But only 4-5 connection requests WITH messages per month
      // Only include message if user explicitly provided one (not default)
      const message = stepConfig.message || stepConfig.connectionMessage || null;
      // Don't use default message - send without message to avoid monthly limit
      console.log(`[Campaign Execution] LinkedIn connect step - sending connection request ${message ? 'with custom message' : 'without message (to avoid monthly limit)'} to ${employee.fullname}`);
      result = await unipileService.sendConnectionRequest(employee, message, linkedinAccountId);
      
      // Add 10-second delay after sending connection request to avoid rate limiting
      // This prevents sending requests too fast and hitting LinkedIn's rate limits
      // Delay applies regardless of success/failure to maintain consistent rate
      console.log(`[Campaign Execution] ⏳ Waiting 10 seconds before next connection request to avoid rate limits...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      console.log(`[Campaign Execution] ✅ Delay complete, ready for next request`);
    } else if (stepType === 'linkedin_message') {
      const message = stepConfig.message || stepConfig.body || 'Hello!';
      console.log(`[Campaign Execution] LinkedIn message step - sending message to ${employee.fullname}`);
      result = await unipileService.sendLinkedInMessage(employee, message, linkedinAccountId);
    } else if (stepType === 'linkedin_follow') {
      console.log(`[Campaign Execution] LinkedIn follow step - following ${employee.fullname}`);
      result = await unipileService.followLinkedInProfile(employee, linkedinAccountId);
    } else if (stepType === 'linkedin_visit') {
      console.log(`[Campaign Execution] LinkedIn visit step - fetching profile via Unipile for ${employee.fullname} (URL: ${linkedinUrl})`);
      console.log(`[Campaign Execution] Using Unipile account ID: ${linkedinAccountId}`);
      
      // Validate inputs before making API call
      if (!linkedinUrl) {
        console.error(`[Campaign Execution] ❌ LinkedIn URL is missing for ${employee.fullname}`);
        result = { success: false, error: 'LinkedIn URL is required' };
        return result;
      }
      
      if (!linkedinAccountId) {
        console.error(`[Campaign Execution] ❌ LinkedIn account ID is missing for ${employee.fullname}`);
        result = { success: false, error: 'LinkedIn account ID is required' };
        return result;
      }
      
      // Check if Unipile service is configured
      if (!unipileService.isConfigured()) {
        console.error(`[Campaign Execution] ❌ Unipile service is not configured`);
        result = { success: false, error: 'Unipile service is not configured' };
        return result;
      }
      
      // Use Unipile profile lookup as a real "visit" and to hydrate contact info
      try {
        console.log(`[Campaign Execution] Calling Unipile API for ${employee.fullname}...`);
        const startTime = Date.now();
        const profileResult = await unipileService.getLinkedInContactDetails(linkedinUrl, linkedinAccountId);
        const duration = Date.now() - startTime;
        console.log(`[Campaign Execution] Unipile API call completed in ${duration}ms for ${employee.fullname}`);
        if (profileResult && profileResult.success !== false) {
          console.log(`[Campaign Execution] ✅ Successfully visited profile for ${employee.fullname} via Unipile`);
          result = {
            success: true,
            message: 'Profile visited via Unipile and contact details fetched',
            profile: profileResult.profile || profileResult
          };
          
          // After successfully visiting profile, generate summary automatically
          try {
            console.log(`[Campaign Execution] Generating profile summary for ${employee.fullname} after visit`);
            const profileData = profileResult.profile || profileResult;
            
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
                
                console.log(`[Campaign Execution] ✅ Profile summary generated for ${employee.fullname}`);
              } else {
                console.warn(`[Campaign Execution] ⚠️ GEMINI_API_KEY not set, skipping summary generation`);
              }
            } catch (geminiErr) {
              console.error('[Campaign Execution] Error calling Gemini API:', geminiErr.message);
            }
            
            // Save summary to campaign_leads table (in lead_data JSONB or metadata)
            if (summary) {
              try {
                // Get current lead_data
                const leadDataQuery = await pool.query(
                  `SELECT lead_data FROM campaign_leads WHERE id = $1`,
                  [campaignLead.id]
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
                  [JSON.stringify(currentLeadData), campaignLead.id]
                );
                
                console.log(`[Campaign Execution] ✅ Profile summary saved to database for ${employee.fullname}`);
              } catch (dbErr) {
                console.error('[Campaign Execution] Error saving summary to database:', dbErr.message);
              }
            }
          } catch (summaryErr) {
            // Don't fail the visit step if summary generation fails
            console.error('[Campaign Execution] Error generating profile summary after visit:', summaryErr);
          }
        } else {
          console.error(`[Campaign Execution] ❌ Failed to visit profile for ${employee.fullname}: ${profileResult?.error || 'Unknown error'}`);
          result = {
            success: false,
            error: profileResult?.error || 'Failed to fetch LinkedIn profile via Unipile'
          };
        }
      } catch (visitErr) {
        console.error(`[Campaign Execution] ❌ Error during LinkedIn visit via Unipile for ${employee.fullname}:`, visitErr.message || visitErr);
        result = { success: false, error: visitErr.message || 'LinkedIn visit failed' };
      }
    } else {
      // For other LinkedIn steps (scrape_profile, company_search, employee_list, autopost, comment_reply)
      console.log(`[Campaign Execution] LinkedIn step ${stepType} - recorded for future implementation`);
      result = { success: true, message: `LinkedIn step ${stepType} recorded` };
    }
    
    return result;
  } catch (error) {
    console.error('[Campaign Execution] LinkedIn step error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  executeLinkedInStep
};

