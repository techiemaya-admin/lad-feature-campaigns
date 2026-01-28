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
          const accountHelper = new LinkedInAccountHelper();
          const accounts = await accountHelper.getActiveLinkedInAccounts(tenantId);
          if (accounts && accounts.length > 0) {
            unipileAccountId = accounts[0].unipile_account_id;
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
            // Fetch recent posts from Unipile
            const postsResult = await UnipileLeadSearchService.getLinkedInPosts(linkedinUrl, unipileAccountId, 10);
            if (postsResult.success && postsResult.posts.length > 0) {
              unipilePosts = postsResult.posts;
              logger.info('Fetched LinkedIn posts from Unipile', {
                leadName: lead.name,
                postCount: unipilePosts.length 
              });
            }
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
      // Create prompt for Gemini
      const prompt = `Analyze the following LinkedIn profile information and create a comprehensive professional summary that CLEARLY includes:

    1. CURRENT POSITION: Explicitly state their current job title and company they work for NOW
    2. PAST COMPANIES: List previous employers and roles in chronological order
    3. PROFESSIONAL BACKGROUND: Years of experience, industry expertise, and specializations
    4. KEY ACCOMPLISHMENTS: Notable projects, achievements, and career milestones
    5. RECENT ACTIVITIES: Insights from their recent posts and professional engagement
    6. SKILLS & EXPERTISE: Technical skills, certifications, and areas of specialization

    Format the summary in clear sections with these headings:
    - Current Role
    - Employment History (with past companies clearly listed)
    - Professional Background
    - Recent Activities & Engagement

    Keep the summary professional, detailed, and factual. Make sure to EXPLICITLY mention:
    - Current company name and title
    - All previous companies they worked at (from employment history)
    - Duration at each company if available

    Profile Information:
    ${profileInfo}

    Professional Summary:`;
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
  // Employment History - Include all past companies
  const employmentHistory = profile.employment_history || profile.experience || profile.experiences || [];
  if (Array.isArray(employmentHistory) && employmentHistory.length > 0) {
    profileInfo += '\n\nEmployment History:';
    employmentHistory.forEach((exp, idx) => {
      const company = exp.organization_name || exp.company_name || exp.company || 'Unknown Company';
      const title = exp.title || exp.position || exp.role || 'Position';
      const startDate = exp.start_date || exp.start_year || exp.from_date || '';
      const endDate = exp.end_date || exp.end_year || exp.to_date || exp.current ? 'Present' : '';
      const duration = exp.duration || (startDate && endDate ? `${startDate} - ${endDate}` : '');
      const isCurrent = exp.current || exp.is_current || endDate === 'Present';
      
      profileInfo += `\n${idx + 1}. ${title} at ${company}`;
      if (duration) {
        profileInfo += ` (${duration})`;
      } else if (startDate) {
        profileInfo += ` (Since ${startDate})`;
      }
      if (isCurrent) {
        profileInfo += ' - CURRENT POSITION';
      }
      
      // Add description if available
      if (exp.description && exp.description.length > 0) {
        profileInfo += `\n   ${exp.description.substring(0, 200)}${exp.description.length > 200 ? '...' : ''}`;
      }
    });
  } else if (baseProfile.company || baseProfile.company_name) {
    // Fallback: If no employment history array, use current company from base profile
    profileInfo += '\n\nCurrent Employment:';
    profileInfo += `\n1. ${baseProfile.title || 'Position'} at ${baseProfile.company || baseProfile.company_name} - CURRENT POSITION`;
  }
  // Education
  const education = profile.education || profile.educations || [];
  if (Array.isArray(education) && education.length > 0) {
    profileInfo += '\n\nEducation:';
    education.forEach((edu, idx) => {
      const school = edu.school || edu.institution || edu.school_name || 'School';
      const degree = edu.degree || edu.degree_name || edu.field_of_study || 'Degree';
      const year = edu.graduation_year || edu.end_year || edu.year || '';
      
      profileInfo += `\n${idx + 1}. ${school} - ${degree}`;
      if (year) profileInfo += ` (${year})`;
    });
  }

  // Skills & Expertise
  const skills = profile.skills || [];
  if (Array.isArray(skills) && skills.length > 0) {
    profileInfo += '\n\nSkills & Expertise:';
    profileInfo += `\n${skills.slice(0, 15).map(s => typeof s === 'string' ? s : s.name).join(', ')}`;
  }

  // Certifications
  const certifications = profile.certifications || [];
  if (Array.isArray(certifications) && certifications.length > 0) {
    profileInfo += '\n\nCertifications:';
    certifications.slice(0, 5).forEach((cert, idx) => {
      profileInfo += `\n${idx + 1}. ${cert.name || cert.title || cert}`;
    });
  }

  // Languages
  const languages = profile.languages || [];
  if (Array.isArray(languages) && languages.length > 0) {
    profileInfo += '\n\nLanguages:';
    profileInfo += `\n${languages.map(l => typeof l === 'string' ? l : l.name).join(', ')}`;
  }
  if (posts && Array.isArray(posts) && posts.length > 0) {
    profileInfo += '\n\nRecent Posts & Activities:';
    posts.slice(0, 5).forEach((post, idx) => {
      const postText = post.text || post.content || post.message || '';
      const postDate = post.date || post.created_at || post.timestamp || '';
      profileInfo += `\n${idx + 1}. ${postText.substring(0, 150)}...`;
      if (postDate) profileInfo += ` (${postDate})`;
    });
  }
  return profileInfo;
}
module.exports = CampaignLeadsSummaryController;
