/**
 * Campaign Leads Summary Controller
 * Handles lead profile summary generation
 * LAD Architecture Compliant - No SQL in controllers, uses logger
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../core/utils/schemaHelper');
const UnipileLeadSearchService = require('../../apollo-leads/services/UnipileLeadSearchService');
const LinkedInAccountHelper = require('../services/LinkedInAccountHelper');
const logger = require('../../../core/utils/logger');

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
      res.status(500).json({
        success: false,
        error: 'Failed to get lead summary',
        details: error.message
      });
    }
  }
  /**
   * POST /api/campaigns/:id/leads/:leadId/summary
   * Generate profile summary for a lead using Unipile profile data and recent posts
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
      let linkedinUrl = null;
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
        linkedinUrl = dbLead.linkedin_url || leadDataFull.linkedin_url || leadDataFull.employee_linkedin_url;
        lead = {
          name: dbLead.first_name && dbLead.last_name
            ? `${dbLead.first_name} ${dbLead.last_name}`.trim()
            : dbLead.first_name || dbLead.last_name || leadDataFull.name || leadDataFull.employee_name || 'Unknown',
          title: dbLead.title || leadDataFull.title || leadDataFull.employee_title || leadDataFull.headline || '',
          company: dbLead.company_name || leadDataFull.company_name || leadDataFull.company || '',
          email: dbLead.email || leadDataFull.email || '',
          phone: dbLead.phone || leadDataFull.phone || '',
          linkedin_url: linkedinUrl,
          ...leadDataFull
        };
      } else {
        linkedinUrl = profileData.linkedin_url || profileData.employee_linkedin_url;
      }
      // Fetch profile data and recent posts from Unipile
      let unipileProfile = null;
      let unipilePosts = [];
      let unipileAccountId = null;
      if (linkedinUrl) {
        try {
          // Get active Unipile account
          const { getAllLinkedInAccountsForTenant } = require('../services/LinkedInAccountHelper');
          const accounts = await getAllLinkedInAccountsForTenant(tenantId, tenantId);
          if (accounts && accounts.length > 0) {
            const userId = req.user?.userId;
            const userAccount = accounts.find(a => a.user_id === userId);
            unipileAccountId = userAccount ? userAccount.unipile_account_id : accounts[0].unipile_account_id;

            if (userAccount) {
              logger.info('Using perfectly matched user account for Unipile data', { userId, accountId: unipileAccountId });
            }
            logger.info('Fetching Unipile profile details', {
              leadName: lead.name,
              linkedinUrl,
              accountId: unipileAccountId
            });
            // Fetch profile details from Unipile
            const profileResult = await UnipileLeadSearchService.getProfileDetails(linkedinUrl, unipileAccountId);
            if (profileResult.success && profileResult.profile) {
              unipileProfile = profileResult.profile;
            }

            // To fetch a user's posts accurately via LinkedIn search, we MUST use their internal URN/member ID (e.g., ACoAAB...). 
            // Passing the public handle (e.g., naveen-yelluru) causes LinkedIn to ignore the filter and return the auth user's posts.
            // Check all possible ID fields from the Unipile profile response
            let profileIdentifier = null;
            if (unipileProfile) {
              profileIdentifier = unipileProfile.id
                || unipileProfile.profile_id
                || unipileProfile.provider_id
                || unipileProfile.member_urn
                || unipileProfile.public_identifier;
            }
            // If still no identifier, try extracting the miniProfile URN from the LinkedIn URL
            if (!profileIdentifier && linkedinUrl) {
              const urnMatch = linkedinUrl.match(/ACoAA[A-Za-z0-9_-]+/);
              if (urnMatch) {
                profileIdentifier = urnMatch[0];
              }
            }
            // Last resort: use the LinkedIn URL itself
            if (!profileIdentifier) {
              profileIdentifier = linkedinUrl;
            }

            logger.info('Using profile identifier for posts fetch', {
              profileIdentifier,
              source: unipileProfile ? 'unipile_profile' : 'url_extraction'
            });

            // Fetch recent posts from Unipile — pass personName so we can filter authored vs. engagement posts
            const leadName = unipileProfile?.name || lead.name || '';
            const postsResult = await UnipileLeadSearchService.getLinkedInPosts(profileIdentifier, unipileAccountId, leadName);
            if (postsResult.success && postsResult.posts.length > 0) {
              unipilePosts = postsResult.posts;
              logger.info('Fetched authored LinkedIn posts from Unipile', {
                leadName: lead.name,
                authoredPostCount: unipilePosts.length,
                engagementActivityCount: postsResult.engagementActivity?.length || 0
              });
            }
            // Also store engagement activity for additional context
            var engagementActivity = postsResult.engagementActivity || [];
          } else {
            logger.warn('No active LinkedIn accounts found for Unipile data fetch');
          }
        } catch (unipileError) {
          logger.error('Failed to fetch Unipile data', {
            error: unipileError.message,
            leadName: lead.name
          });
          // Continue with fallback to basic profile data
        }
      }
      // Build comprehensive profile information for Gemini, prioritizing Unipile data
      const profileInfo = buildProfileInfo(lead, unipileProfile, unipilePosts);
      // Create prompt for Gemini — designed to produce UNIQUE, data-specific summaries
      const personName = unipileProfile?.name || lead.name || 'this professional';
      const personTitle = unipileProfile?.title || unipileProfile?.headline || lead.title || '';
      const personCompany = unipileProfile?.company || unipileProfile?.company_name || lead.company || '';
      const hasPosts = unipilePosts && unipilePosts.length > 0;

      const prompt = `You are writing a unique profile summary for a SPECIFIC person. This is NOT a template — every summary must be distinctly different based on the actual data provided.

PERSON: ${personName}
${personTitle ? `ROLE: ${personTitle}` : ''}
${personCompany ? `COMPANY: ${personCompany}` : ''}

FULL PROFILE DATA:
${profileInfo}

INSTRUCTIONS:
- Write a 2-3 paragraph summary that is UNIQUE to ${personName} — no two summaries should ever sound similar
- Start the first paragraph by mentioning ${personName} BY NAME and their SPECIFIC current role${personCompany ? ` at ${personCompany}` : ''}
- Use ONLY facts from the profile data above. Do NOT invent accomplishments, skills, or details not present in the data
- If experience history is available, mention their career trajectory with specific company names and roles
- If education data is available, mention their educational background specifically
${hasPosts ? '- The profile data includes SELF-AUTHORED posts (posts this person wrote). Reference these with SPECIFIC topics — quote short phrases from their actual posts' : '- This person has no self-authored posts found. Focus on their professional positioning and expertise based on their title and experience'}
- Write in a natural, conversational tone — vary sentence structure and avoid formulaic patterns
- If the data is limited (only name/title/company), acknowledge that and write a shorter, honest summary instead of padding with generic statements

CRITICAL RULES:
❌ Do NOT use filler phrases like "demonstrates a keen interest" or "passionate professional" or "well-positioned in the industry" unless the data proves this
❌ Do NOT generate generic summaries that could apply to anyone — each must be SPECIFIC to the provided data
❌ Do NOT invent achievements, projects, or skills not explicitly mentioned in the profile data
✅ DO mention specific companies, job titles, industries, and topics from the actual data
✅ DO keep it concise — if data is sparse, a shorter summary is better than a padded one

Summary for ${personName}:`;
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();
      // Save summary to lead_data
      // LAD Architecture: Use model layer instead of direct SQL in controller
      try {
        const schema = getSchema(req);
        await CampaignLeadModel.updateLeadData(leadId, campaignId, tenantId, schema, {
          profile_summary: summary,
          profile_summary_generated_at: new Date().toISOString(),
          profile_summary_source: unipileProfile ? 'unipile_profile_and_posts' : 'fallback_profile_data'
        });
      } catch (saveError) {
        // Don't fail the request if save fails
      }
      res.json({
        success: true,
        summary: summary,
        source: unipileProfile ? 'unipile' : 'fallback',
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate lead summary',
        details: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/preview/lead-summary
   * Generate a profile summary from raw profile data .
   * Used by the AI Lead Finder (advanced-search) preview feature.
   */
  static async generatePreviewSummary(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { profileData } = req.body;

      if (!profileData || !profileData.name) {
        return res.status(400).json({
          success: false,
          error: 'profileData with at least a name is required'
        });
      }

      // Initialize Gemini AI
      let genAI = null;
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (geminiApiKey) {
          genAI = new GoogleGenerativeAI(geminiApiKey);
        }
      } catch (e) { /* ignore */ }

      if (!genAI) {
        return res.status(503).json({
          success: false,
          error: 'Gemini AI is not available. Please set GEMINI_API_KEY environment variable.'
        });
      }

      const lead = {
        name: profileData.name || 'Unknown',
        title: profileData.title || profileData.headline || '',
        company: profileData.company || profileData.current_company || '',
        linkedin_url: profileData.linkedin_url || profileData.profile_url || ''
      };

      const linkedinUrl = lead.linkedin_url;

      // Fetch Unipile profile + posts if we have a LinkedIn URL
      let unipileProfile = null;
      let unipilePosts = [];

      if (linkedinUrl) {
        try {
          const { getAllLinkedInAccountsForTenant } = require('../services/LinkedInAccountHelper');
          const accounts = await getAllLinkedInAccountsForTenant(tenantId, tenantId);
          if (accounts && accounts.length > 0) {
            const userId = req.user?.userId;
            const userAccount = accounts.find(a => a.user_id === userId);
            const unipileAccountId = userAccount
              ? userAccount.unipile_account_id
              : accounts[0].unipile_account_id;

            logger.info('[PreviewSummary] Fetching Unipile profile', { leadName: lead.name, linkedinUrl, unipileAccountId });

            const profileResult = await UnipileLeadSearchService.getProfileDetails(linkedinUrl, unipileAccountId);
            if (profileResult.success && profileResult.profile) {
              unipileProfile = profileResult.profile;
            }

            // Determine best identifier for posts
            let profileIdentifier = unipileProfile?.id
              || unipileProfile?.profile_id
              || unipileProfile?.provider_id
              || unipileProfile?.public_identifier;

            if (!profileIdentifier) {
              const urnMatch = linkedinUrl.match(/ACoAA[A-Za-z0-9_-]+/);
              profileIdentifier = urnMatch ? urnMatch[0] : linkedinUrl;
            }

            const leadName = unipileProfile?.name || lead.name || '';
            const postsResult = await UnipileLeadSearchService.getLinkedInPosts(profileIdentifier, unipileAccountId, leadName);
            if (postsResult.success && postsResult.posts.length > 0) {
              unipilePosts = postsResult.posts;
            }
          }
        } catch (unipileError) {
          logger.warn('[PreviewSummary] Unipile fetch failed, proceeding with basic data', { error: unipileError.message });
        }
      }

      const profileInfo = buildProfileInfo(lead, unipileProfile, unipilePosts);
      const personName = unipileProfile?.name || lead.name || 'this professional';
      const personTitle = unipileProfile?.title || unipileProfile?.headline || lead.title || '';
      const personCompany = unipileProfile?.company || unipileProfile?.company_name || lead.company || '';
      const hasPosts = unipilePosts && unipilePosts.length > 0;

      const prompt = `You are writing a unique profile summary for a SPECIFIC person. This is NOT a template — every summary must be distinctly different based on the actual data provided.

PERSON: ${personName}
${personTitle ? `ROLE: ${personTitle}` : ''}
${personCompany ? `COMPANY: ${personCompany}` : ''}

FULL PROFILE DATA:
${profileInfo}

INSTRUCTIONS:
- Write a 2-3 paragraph summary that is UNIQUE to ${personName} — no two summaries should ever sound similar
- Start the first paragraph by mentioning ${personName} BY NAME and their SPECIFIC current role${personCompany ? ` at ${personCompany}` : ''}
- Use ONLY facts from the profile data above. Do NOT invent accomplishments, skills, or details not present in the data
- If experience history is available, mention their career trajectory with specific company names and roles
- If education data is available, mention their educational background specifically
${hasPosts ? '- The profile data includes SELF-AUTHORED posts (posts this person wrote). Reference these with SPECIFIC topics — quote short phrases from their actual posts' : '- This person has no self-authored posts found. Focus on their professional positioning and expertise based on their title and experience'}
- Write in a natural, conversational tone — vary sentence structure and avoid formulaic patterns
- If the data is limited (only name/title/company), acknowledge that and write a shorter, honest summary instead of padding with generic statements

CRITICAL RULES:
❌ Do NOT use filler phrases like "demonstrates a keen interest" or "passionate professional" or "well-positioned in the industry" unless the data proves this
❌ Do NOT generate generic summaries that could apply to anyone — each must be SPECIFIC to the provided data
❌ Do NOT invent achievements, projects, or skills not explicitly mentioned in the profile data
✅ DO mention specific companies, job titles, industries, and topics from the actual data
✅ DO keep it concise — if data is sparse, a shorter summary is better than a padded one

Summary for ${personName}:`;

      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();

      res.json({
        success: true,
        summary: summary,
        source: unipileProfile ? 'unipile' : 'fallback',
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[PreviewSummary] Failed to generate preview summary', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to generate preview summary',
        details: error.message
      });
    }
  }
}
/**
 * Build comprehensive profile information from Unipile and fallback data
 */
function buildProfileInfo(baseProfile, unipileProfile, posts) {
  // Use Unipile data if available, fallback to base profile
  const profile = unipileProfile || baseProfile;
  let profileInfo = `
Name: ${profile.name || baseProfile.name || 'Unknown'}
Title: ${profile.title || profile.headline || baseProfile.title || 'Not specified'}
Company: ${profile.company || profile.company_name || baseProfile.company || 'Not specified'}
Location: ${profile.location || profile.city || baseProfile.location || 'Not specified'}
LinkedIn: ${profile.linkedin_url || baseProfile.linkedin_url || 'Not available'}
  `.trim();
  if (profile.headline || profile.employee_headline) {
    profileInfo += `\nHeadline: ${profile.headline || profile.employee_headline}`;
  }
  if (profile.bio || profile.summary || profile.about) {
    profileInfo += `\nBio/About: ${profile.bio || profile.summary || profile.about}`;
  }
  // Industry
  if (profile.industry || baseProfile.industry) {
    profileInfo += `\nIndustry: ${profile.industry || baseProfile.industry}`;
  }
  // Seniority & Department
  if (profile.seniority) {
    profileInfo += `\nSeniority: ${profile.seniority}`;
  }
  if (profile.departments) {
    const dept = Array.isArray(profile.departments) ? profile.departments.join(', ') : profile.departments;
    profileInfo += `\nDepartment: ${dept}`;
  }
  // Connections count
  if (profile.connections_count || profile.follower_count) {
    profileInfo += `\nConnections/Followers: ${profile.connections_count || profile.follower_count}`;
  }
  if (profile.experience || profile.experiences) {
    const experiences = profile.experience || profile.experiences || [];
    if (Array.isArray(experiences) && experiences.length > 0) {
      profileInfo += '\n\nRecent Experience:';
      experiences.slice(0, 4).forEach((exp, idx) => {
        profileInfo += `\n${idx + 1}. ${exp.title || exp.position || 'Position'} at ${exp.company || exp.company_name || 'Company'}`;
        if (exp.duration) profileInfo += ` (${exp.duration})`;
        if (exp.description) profileInfo += ` — ${exp.description.substring(0, 200)}`;
        if (exp.start_date) profileInfo += ` [Started: ${exp.start_date}]`;
      });
    }
  }
  if (profile.education || profile.educations) {
    const education = profile.education || profile.educations || [];
    if (Array.isArray(education) && education.length > 0) {
      profileInfo += '\n\nEducation:';
      education.slice(0, 3).forEach((edu, idx) => {
        profileInfo += `\n${idx + 1}. ${edu.school || edu.institution || 'School'}`;
        if (edu.degree) profileInfo += ` — ${edu.degree}`;
        if (edu.field_of_study) profileInfo += ` in ${edu.field_of_study}`;
        if (edu.start_year || edu.end_year) profileInfo += ` (${edu.start_year || ''}–${edu.end_year || ''})`;
      });
    }
  }
  // Skills
  if (profile.skills) {
    const skills = Array.isArray(profile.skills)
      ? profile.skills.slice(0, 10).map(s => typeof s === 'string' ? s : s.name || s.skill || '').filter(Boolean)
      : [];
    if (skills.length > 0) {
      profileInfo += `\n\nTop Skills: ${skills.join(', ')}`;
    }
  }
  // Languages
  if (profile.languages) {
    const langs = Array.isArray(profile.languages)
      ? profile.languages.map(l => typeof l === 'string' ? l : l.name || '').filter(Boolean)
      : [];
    if (langs.length > 0) {
      profileInfo += `\nLanguages: ${langs.join(', ')}`;
    }
  }

  // Self-authored posts (posts this person actually wrote)
  if (posts && Array.isArray(posts) && posts.length > 0) {
    profileInfo += '\n\nSelf-Authored Posts (written by this person):';
    posts.slice(0, 5).forEach((post, idx) => {
      const postText = post.text || post.content || post.message || '';
      const postDate = post.date || post.created_at || post.timestamp || '';
      const truncated = postText.length > 200 ? postText.substring(0, 200) + '...' : postText;
      profileInfo += `\n${idx + 1}. "${truncated}"`;
      if (postDate) profileInfo += ` (${postDate})`;
      if (post.likes_count || post.reactions) profileInfo += ` [${post.likes_count || post.reactions} reactions]`;
      if (post.comments_count) profileInfo += ` [${post.comments_count} comments]`;
    });
  } else {
    profileInfo += '\n\n[No self-authored LinkedIn posts found]';
  }

  return profileInfo;
}
module.exports = CampaignLeadsSummaryController;
