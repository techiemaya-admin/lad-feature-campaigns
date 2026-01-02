/**
 * Campaign Leads Reveal Controller
 * Handles email and phone reveal for campaign leads using Apollo API
 * LAD Architecture Compliant - No SQL in controllers, uses logger
 */

const axios = require('axios');
const CampaignLeadRepository = require('../repositories/CampaignLeadRepository');
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
 * Get Apollo Leads URL specifically for Apollo service calls
 */
function getApolloLeadsUrl() {
  if (process.env.APOLLO_LEADS_URL) return process.env.APOLLO_LEADS_URL;
  return getBackendUrl();
}

const BACKEND_URL = getBackendUrl();
const APOLLO_LEADS_URL = getApolloLeadsUrl();

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
    const dbLead = await CampaignLeadRepository.getLeadById(leadId, campaignId, tenantId, schema);
    if (!dbLead) {
      logger.warn('[Campaign Leads Reveal] Lead not found for update', { leadId, campaignId });
      return;
    }

    // Map database result using model
    const lead = CampaignLeadModel.mapLeadFromDB(dbLead);

    // Parse existing snapshot and lead_data
    let snapshot = lead.snapshot || {};
    let leadData = lead.leadData || {};
    
    // Ensure snapshot and leadData are objects
    if (typeof snapshot === 'string') {
      try {
        snapshot = JSON.parse(snapshot);
      } catch (e) {
        logger.warn('[Campaign Leads Reveal] Error parsing snapshot', { error: e.message });
        snapshot = {};
      }
    }
    
    if (typeof leadData === 'string') {
      try {
        leadData = JSON.parse(leadData);
      } catch (e) {
        logger.warn('[Campaign Leads Reveal] Error parsing lead_data', { error: e.message });
        leadData = {};
      }
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

    // Save updated data using repository
    await CampaignLeadRepository.update(leadId, tenantId, {
      snapshot: snapshot,
      lead_data: leadData
    }, req);

    logger.info('[Campaign Leads Reveal] Contact revealed and saved to campaign lead', { 
      leadId, 
      contactType, 
      from_cache: metadata.from_cache 
    });
  } catch (updateError) {
    logger.error('[Campaign Leads Reveal] Error updating lead with revealed contact', { 
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
   */
  static async revealLeadEmail(req, res) {
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

      logger.info('[Campaign Leads Reveal] Revealing email via Apollo API', { campaignId, leadId, apollo_person_id });

      const apolloResponse = await axios.post(
        `${APOLLO_LEADS_URL}/api/apollo-leads/reveal-email`,
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
        credits_used: credits_used
      });
    } catch (error) {
      logger.error('[Campaign Leads Reveal] Error revealing email', { error: error.message, stack: error.stack });
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

      logger.info('[Campaign Leads Reveal] Revealing phone via Apollo API', { campaignId, leadId, apollo_person_id });

      const apolloResponse = await axios.post(
        `${APOLLO_LEADS_URL}/api/apollo-leads/reveal-phone`,
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
      logger.error('[Campaign Leads Reveal] Error revealing phone', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to reveal phone',
        message: error.message
      });
    }
  }
}

module.exports = CampaignLeadsRevealController;

