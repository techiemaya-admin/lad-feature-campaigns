/**
 * Campaign Leads Reveal Controller
 * Handles email and phone reveal for campaign leads using Apollo API
 * LAD Architecture Compliant - No SQL in controllers, uses logger
 */

const axios = require('axios');
const CampaignLeadModel = require('../models/CampaignLeadModel');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
/**
 * Get backend URL from environment variables
 * LAD Architecture: No hardcoded URLs
 */
function getBackendUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL;
  if (process.env.BACKEND_INTERNAL_URL) return process.env.BACKEND_INTERNAL_URL;
  if (process.env.NEXT_PUBLIC_BACKEND_URL) return process.env.NEXT_PUBLIC_BACKEND_URL;
  throw new Error('BACKEND_URL, BACKEND_INTERNAL_URL, or NEXT_PUBLIC_BACKEND_URL must be configured');
}
/**
 * Get authentication headers from request
 */
function getAuthHeaders(req) {
  const headers = {
    'Content-Type': 'application/json'
  };
  const authToken = req.headers.authorization || (req.user?.token ? `Bearer ${req.user.token}` : null);
  if (authToken) {
    headers['Authorization'] = authToken;
  }
  return headers;
}
/**
 * Update campaign lead with revealed contact info
 */
async function updateLeadWithRevealedContact(leadId, campaignId, tenantId, req, contactType, contactValue, metadata) {
  const schema = getSchema(req);
  try {
    const lead = await CampaignLeadModel.getLeadById(leadId, campaignId, tenantId, schema);
    if (!lead) {
      return;
    }
    // Parse existing snapshot and lead_data
    let snapshot = {};
    let leadData = {};
    try {
      snapshot = typeof lead.snapshot === 'string' ? JSON.parse(lead.snapshot || '{}') : (lead.snapshot || {});
    } catch (e) {
    }
    try {
      leadData = typeof lead.lead_data === 'string' ? JSON.parse(lead.lead_data || '{}') : (lead.lead_data || {});
    } catch (e) {
    }
    // Update with revealed contact info
    if (contactType === 'email') {
      snapshot.email = contactValue;
      leadData.email = contactValue;
      leadData.employee_email = contactValue;
      leadData.email_revealed_at = new Date().toISOString();
      leadData.email_revealed_from_cache = metadata.from_cache;
      leadData.email_reveal_credits_used = metadata.credits_used;
    } else if (contactType === 'phone') {
      snapshot.phone = contactValue;
      leadData.phone = contactValue;
      leadData.employee_phone = contactValue;
      leadData.phone_revealed_at = new Date().toISOString();
      leadData.phone_revealed_from_cache = metadata.from_cache;
      leadData.phone_reveal_credits_used = metadata.credits_used;
    }
    // Save updated data
    await CampaignLeadModel.update(leadId, tenantId, {
      snapshot: snapshot,
      lead_data: leadData
    }, req);
    
    logger.info('Lead contact info revealed and updated', {
      leadId, 
      contactType, 
      from_cache: metadata.from_cache 
    });
  } catch (updateError) {
    logger.error('Failed to update lead with revealed contact', {
      error: updateError.message, 
      stack: updateError.stack,
      contactType
    });
    // Don't fail the request if update fails - contact was still revealed
  }
}
class CampaignLeadsRevealController {
  /**
   * POST /api/campaigns/:id/leads/:leadId/reveal-email
   * Reveal email for a campaign lead using Apollo API
   * OPTIMIZATION: Check campaign_leads.enriched_email first to avoid unnecessary API calls and credit deductions
   */
  static async revealLeadEmail(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;
      const { apollo_person_id } = req.body;
      const schema = getSchema(req);

      // STEP 1: Check if email is already enriched in campaign_leads table
      const lead = await CampaignLeadModel.getLeadById(leadId, campaignId, tenantId, schema);
      if (lead && lead.enriched_email) {
        logger.info('[Campaign Reveal] Email already enriched in database - no credits deducted', {
          leadId,
          campaignId,
          tenantId
        });
        
        return res.json({
          success: true,
          email: lead.enriched_email,
          from_cache: true,
          from_database: true,
          credits_used: 0
        });
      }

      // STEP 2: Email not in database, proceed with Apollo API
      if (!apollo_person_id) {
        return res.status(400).json({
          success: false,
          error: 'apollo_person_id is required'
        });
      }
      const BACKEND_URL = getBackendUrl();
      const headers = getAuthHeaders(req);
      const apolloResponse = await axios.post(
        `${BACKEND_URL}/api/apollo-leads/reveal-email`,
        {
          person_id: apollo_person_id,
          campaign_id: campaignId,
          lead_id: leadId
        },
        { headers, timeout: 30000 }
      );
      if (!apolloResponse.data.success) {
        return res.status(400).json({
          success: false,
          error: apolloResponse.data.error || 'Failed to reveal email',
          credits_used: apolloResponse.data.credits_used || 0
        });
      }
      const { email, from_cache, credits_used } = apolloResponse.data;
      // Update campaign lead with revealed email
      await updateLeadWithRevealedContact(leadId, campaignId, tenantId, req, 'email', email, {
        from_cache,
        credits_used
      });
      res.json({
        success: true,
        email: email,
        from_cache: from_cache,
        from_database: false,
        credits_used: credits_used
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to reveal email',
        message: error.message
      });
    }
  }
  /**
   * POST /api/campaigns/:id/leads/:leadId/reveal-phone
   * Reveal phone for a campaign lead using Apollo API
   */
  static async revealLeadPhone(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;
      const { apollo_person_id } = req.body;
      if (!apollo_person_id) {
        return res.status(400).json({
          success: false,
          error: 'apollo_person_id is required'
        });
      }
      const BACKEND_URL = getBackendUrl();
      const headers = getAuthHeaders(req);
      const apolloResponse = await axios.post(
        `${BACKEND_URL}/api/apollo-leads/reveal-phone`,
        {
          person_id: apollo_person_id,
          campaign_id: campaignId,
          lead_id: leadId
        },
        { headers, timeout: 30000 }
      );
      if (!apolloResponse.data.success) {
        return res.status(400).json({
          success: false,
          error: apolloResponse.data.error || 'Failed to reveal phone',
          credits_used: apolloResponse.data.credits_used || 0
        });
      }
      const { phone, from_cache, credits_used, processing, message } = apolloResponse.data;
      // Update campaign lead with revealed phone (if phone is available immediately)
      if (phone && !processing) {
        await updateLeadWithRevealedContact(leadId, campaignId, tenantId, req, 'phone', phone, {
          from_cache,
          credits_used
        });
      }
      res.json({
        success: true,
        phone: phone,
        from_cache: from_cache,
        credits_used: credits_used,
        processing: processing || false,
        message: message || null
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to reveal phone',
        message: error.message
      });
    }
  }

  /**
   * POST /api/campaigns/:id/leads/:leadId/reveal-linkedin
   * Reveal LinkedIn URL for a campaign lead
   * OPTIMIZATION: Check campaign_leads.enriched_linkedin_url first to avoid unnecessary API calls
   */
  static async revealLeadLinkedIn(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id: campaignId, leadId } = req.params;
      const schema = getSchema(req);

      // STEP 1: Check if LinkedIn URL is already enriched in campaign_leads table
      const lead = await CampaignLeadModel.getLeadById(leadId, campaignId, tenantId, schema);
      if (lead && lead.enriched_linkedin_url) {
        logger.info('[Campaign Reveal] LinkedIn URL already enriched in database - no credits deducted', {
          leadId,
          campaignId,
          tenantId
        });
        
        return res.json({
          success: true,
          linkedin_url: lead.enriched_linkedin_url,
          from_cache: true,
          from_database: true,
          credits_used: 0
        });
      }

      // STEP 2: Check lead_data for LinkedIn URL (might be in snapshot/lead_data but not in enriched_linkedin_url)
      if (lead) {
        let leadData = {};
        let snapshot = {};
        try {
          leadData = typeof lead.lead_data === 'string' ? JSON.parse(lead.lead_data || '{}') : (lead.lead_data || {});
          snapshot = typeof lead.snapshot === 'string' ? JSON.parse(lead.snapshot || '{}') : (lead.snapshot || {});
        } catch (e) {
          // Continue if parsing fails
        }

        const linkedinUrl = snapshot.linkedin_url || leadData.linkedin_url || leadData.employee_linkedin_url || leadData.linkedin || null;
        if (linkedinUrl) {
          logger.info('[Campaign Reveal] LinkedIn URL found in lead_data - no credits deducted', {
            leadId,
            campaignId,
            tenantId
          });
          
          return res.json({
            success: true,
            linkedin_url: linkedinUrl,
            from_cache: true,
            from_lead_data: true,
            credits_used: 0
          });
        }
      }

      // STEP 3: LinkedIn URL not found in database
      return res.json({
        success: false,
        error: 'LinkedIn URL not available for this lead',
        credits_used: 0
      });
    } catch (error) {
      logger.error('[Campaign Reveal] Failed to reveal LinkedIn URL', {
        error: error.message,
        leadId: req.params.leadId,
        campaignId: req.params.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to reveal LinkedIn URL',
        message: error.message
      });
    }
  }
}
module.exports = CampaignLeadsRevealController;
