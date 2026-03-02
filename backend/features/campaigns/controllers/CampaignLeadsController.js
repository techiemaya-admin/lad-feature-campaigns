/**
 * Campaign Leads Controller
 * Handles lead management for campaigns
 * LAD Architecture Compliant - No SQL in controllers, uses logger instead of console
 */

const CampaignLeadModel = require('../models/CampaignLeadModel');
const CampaignLeadActivityModel = require('../models/CampaignLeadActivityModel');
const { getSchema } = require('../../../core/utils/schemaHelper');
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

      // Also fetch from campaign_analytics table as requested
      const { pool } = require('../../../shared/database/connection');
      const extLeadIdMap = {};
      try {
        const analyticsResult = await pool.query("SELECT lead_id, action_type FROM campaign_analytics WHERE campaign_id = $1 AND status = 'success'", [id]);
        analyticsResult.rows.forEach(row => {
          const extId = row.lead_id;
          if (!extId) return;
          if (!extLeadIdMap[extId]) extLeadIdMap[extId] = { sent: false, connected: false, replied: false };

          if (row.action_type === 'CONNECTION_SENT' || row.action_type === 'CONNECTION_SENT_WITH_MESSAGE' || row.action_type === 'EMAIL_SENT' || row.action_type === 'MESSAGE_SENT') {
            extLeadIdMap[extId].sent = true;
          }
          if (row.action_type === 'CONNECTION_ACCEPTED' || row.action_type === 'CONTACTED') {
            extLeadIdMap[extId].connected = true;
          }
          if (row.action_type === 'REPLY_RECEIVED') {
            extLeadIdMap[extId].replied = true;
          }
        });
      } catch (e) {
        logger.warn('Failed to fetch from campaign_analytics in leads', e);
      }

      // Fetch activities to determine true progression state for frontend filtering
      const activities = await CampaignLeadActivityModel.getByCampaignId(id, tenantId, { limit: 10000 }, req);
      const leadProgressMap = {};
      activities.forEach(act => {
        const leadId = act.campaign_lead_id;
        if (!leadProgressMap[leadId]) leadProgressMap[leadId] = { sent: false, connected: false, replied: false };

        if (act.action_type || act.step_type) {
          const type = (act.action_type || act.step_type).toLowerCase();
          const status = (act.status || '').toLowerCase();

          if (
            type.includes('send') ||
            type.includes('email') ||
            status === 'sent'
          ) {
            // Include message delivery or anything indicating sending
            // but restrict connection tracking to analytics table
            if (type !== 'linkedin_visit' && type !== 'lead_generation' && type !== 'linkedin_connect' && status !== 'skipped' && status !== 'failed') {
              leadProgressMap[leadId].sent = true;
            }
          }

          if (
            status === 'contacted'
          ) {
            if (status !== 'skipped' && status !== 'failed') {
              leadProgressMap[leadId].connected = true;
            }
          }

          if (type.includes('reply') || status === 'replied') {
            if (status !== 'skipped' && status !== 'failed') {
              leadProgressMap[leadId].replied = true;
            }
          }
        }
      });

      // Format leads for frontend
      const formattedLeads = leads.map(row => {
        try {
          // Check if this is an inbound lead (has lead_id and inbound data from leads table)
          const isInboundLead = !!row.lead_id && (row.inbound_first_name || row.inbound_last_name || row.inbound_email);
          // Parse JSONB fields safely (for outbound leads)
          let snapshot = {};
          let leadData = {};
          if (!isInboundLead) {
            try {
              snapshot = typeof row.snapshot === 'string'
                ? JSON.parse(row.snapshot || '{}')
                : (row.snapshot || {});
            } catch (e) {
              snapshot = {};
            }
            try {
              leadData = typeof row.lead_data === 'string'
                ? JSON.parse(row.lead_data || '{}')
                : (row.lead_data || {});
            } catch (e) {
              leadData = {};
            }
          }
          // Extract profile summary from lead_data if it exists
          const profileSummary = leadData.profile_summary || null;
          // Extract apollo_person_id from lead_data (needed for reveal email/phone - only for outbound)
          const apolloPersonId = leadData.apollo_person_id || leadData.id || leadData.apollo_id || null;
          // Extract name fields - Priority: inbound data > snapshot > lead_data
          const firstName = isInboundLead
            ? row.inbound_first_name
            : (snapshot.first_name || leadData.first_name || leadData.employee_name?.split(' ')[0] || '');
          const lastName = isInboundLead
            ? row.inbound_last_name
            : (snapshot.last_name || leadData.last_name || leadData.employee_name?.split(' ').slice(1).join(' ') || '');
          // Build full name
          let name = '';
          if (firstName && lastName) {
            name = `${firstName} ${lastName}`.trim();
          } else if (firstName) {
            name = firstName;
          } else if (lastName) {
            name = lastName;
          } else if (!isInboundLead) {
            name = leadData.name || leadData.employee_name || leadData.fullname || snapshot.name || 'Unknown';
          } else {
            name = 'Unknown';
          }
          return {
            id: row.id,
            campaign_id: row.campaign_id,
            lead_id: row.lead_id,
            status: row.status,
            is_inbound: isInboundLead, // Flag to identify inbound leads
            name: name,
            first_name: firstName,
            last_name: lastName,
            email: isInboundLead
              ? row.inbound_email
              : (snapshot.email || leadData.email || leadData.employee_email || leadData.work_email || null),
            phone: isInboundLead
              ? row.inbound_phone
              : (snapshot.phone || leadData.phone || leadData.employee_phone || leadData.phone_number || null),
            company: isInboundLead
              ? row.inbound_company_name
              : (snapshot.company_name || leadData.company_name || leadData.company || leadData.employee_company || leadData.organization?.name || null),
            title: isInboundLead
              ? row.inbound_title
              : (snapshot.title || leadData.title || leadData.employee_title || leadData.job_title || leadData.headline || null),
            linkedin_url: isInboundLead
              ? row.inbound_linkedin_url
              : (snapshot.linkedin_url || leadData.linkedin_url || leadData.employee_linkedin_url || leadData.linkedin || null),
            photo_url: isInboundLead
              ? null
              : (leadData.photo_url || leadData.employee_photo_url || leadData.avatar || snapshot.photo_url || null),
            profile_summary: profileSummary,
            apollo_person_id: apolloPersonId, // Include apollo_person_id for reveal functionality (only outbound)
            // Include enriched fields for checking if email/linkedin is already revealed
            enriched_email: row.enriched_email || null,
            enriched_linkedin_url: row.enriched_linkedin_url || null,
            has_sent: leadProgressMap[row.id]?.sent || extLeadIdMap[row.lead_id]?.sent || false,
            has_connected: leadProgressMap[row.id]?.connected || extLeadIdMap[row.lead_id]?.connected || false,
            has_replied: leadProgressMap[row.id]?.replied || extLeadIdMap[row.lead_id]?.replied || false,
            created_at: row.created_at,
            updated_at: row.updated_at
          };
        } catch (formatError) {
          // Return minimal data if formatting fails
          return {
            id: row.id,
            campaign_id: row.campaign_id,
            lead_id: row.lead_id,
            status: row.status,
            is_inbound: false,
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
            has_sent: false,
            has_connected: false,
            has_replied: false,
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
      // ✅ Emit SSE event to update leads count live
      try {
        const { campaignStatsTracker } = require('../services/campaignStatsTracker');
        const { campaignEventsService } = require('../services/campaignEventsService');
        const stats = await campaignStatsTracker.getStats(id);
        await campaignEventsService.publishCampaignListUpdate(id, stats);
      } catch (sseError) {
        // Don't fail the operation
      }
      res.status(201).json({
        success: true,
        data: createdLeads
      });
    } catch (error) {
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
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign activities',
        message: error.message
      });
    }
  }
}
module.exports = CampaignLeadsController;
