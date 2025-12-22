const express = require('express');
const router = express.Router();
const { pool } = require('../../shared/database/connection');
const { authenticateToken: jwtAuth } = require('../../core/middleware/auth');

/**
 * GET /api/campaigns
 * List all campaigns with filters
 */
router.get('/', jwtAuth, async (req, res) => {
  try {
    const { search, status, organization_id } = req.query;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = organization_id || req.user?.organization_id;

    // Check if campaigns table exists, if not return empty array
    try {
      await pool.query('SELECT 1 FROM campaigns LIMIT 1');
    } catch (tableError) {
      console.warn('[Campaigns] Campaigns table does not exist yet. Returning empty array.');
      return res.json({
        success: true,
        data: []
      });
    }

    let query = `
      SELECT 
        c.*,
        COUNT(DISTINCT cl.id) as leads_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'opened' THEN cla.id END) as opened_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'clicked' THEN cla.id END) as clicked_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      LEFT JOIN campaign_lead_activities cla ON cl.id = cla.campaign_lead_id
      WHERE c.is_deleted = FALSE
    `;
    const params = [];
    let paramIndex = 1;

    if (orgId) {
      query += ` AND c.organization_id = $${paramIndex++}`;
      params.push(orgId);
    } else if (userId) {
      query += ` AND c.created_by = $${paramIndex++}`;
      params.push(userId);
    }

    if (status && status !== 'all') {
      query += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }

    if (search) {
      query += ` AND c.name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const result = await pool.query(query, params);
    
    // Fetch steps for each campaign and ensure counts are properly formatted
    const campaignsWithSteps = await Promise.all(
      result.rows.map(async (campaign) => {
        try {
          const stepsQuery = `SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY "order" ASC`;
          const stepsResult = await pool.query(stepsQuery, [campaign.id]);
          
          // Ensure all count fields are integers and not null
          return {
            ...campaign,
            leads_count: parseInt(campaign.leads_count) || 0,
            sent_count: parseInt(campaign.sent_count) || 0,
            delivered_count: parseInt(campaign.delivered_count) || 0,
            connected_count: parseInt(campaign.connected_count) || 0,
            replied_count: parseInt(campaign.replied_count) || 0,
            opened_count: parseInt(campaign.opened_count) || 0,
            clicked_count: parseInt(campaign.clicked_count) || 0,
            steps: stepsResult.rows || []
          };
        } catch (error) {
          // If campaign_steps table doesn't exist or error, return campaign without steps
          console.warn(`[Campaigns] Could not fetch steps for campaign ${campaign.id}:`, error.message);
          return {
            ...campaign,
            leads_count: parseInt(campaign.leads_count) || 0,
            sent_count: parseInt(campaign.sent_count) || 0,
            delivered_count: parseInt(campaign.delivered_count) || 0,
            connected_count: parseInt(campaign.connected_count) || 0,
            replied_count: parseInt(campaign.replied_count) || 0,
            opened_count: parseInt(campaign.opened_count) || 0,
            clicked_count: parseInt(campaign.clicked_count) || 0,
            steps: []
          };
        }
      })
    );
    
    console.log(`[Campaigns] Returning ${campaignsWithSteps.length} campaigns with counts:`, 
      campaignsWithSteps.map(c => ({
        id: c.id,
        name: c.name,
        leads: c.leads_count,
        sent: c.sent_count,
        connected: c.connected_count,
        replied: c.replied_count
      }))
    );
    
    res.json({
      success: true,
      data: campaignsWithSteps
    });
  } catch (error) {
    console.error('[Campaigns] Error listing campaigns:', error);
    console.error('[Campaigns] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to list campaigns',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/campaigns/stats
 * Get campaign statistics
 */
router.get('/stats', jwtAuth, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    // Check if campaigns table exists, if not return empty stats
    try {
      await pool.query('SELECT 1 FROM campaigns LIMIT 1');
    } catch (tableError) {
      console.warn('[Campaigns Stats] Campaigns table does not exist yet. Returning empty stats.');
      return res.json({
        success: true,
        data: {
          total_campaigns: 0,
          active_campaigns: 0,
          total_leads: 0,
          total_sent: 0,
          total_delivered: 0,
          total_connected: 0,
          total_replied: 0,
          avg_connection_rate: 0,
          avg_reply_rate: 0,
          instagram_connection_rate: 0,
          whatsapp_connection_rate: 0,
          voice_agent_connection_rate: 0
        }
      });
    }

    let query = `
      SELECT 
        COUNT(DISTINCT c.id) as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns,
        COUNT(DISTINCT cl.id) as total_leads,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as total_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as total_delivered,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as total_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as total_replied,
        -- Platform-specific stats (check both channel and step_type for better detection)
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' AND (LOWER(cla.channel) = 'instagram' OR LOWER(cla.step_type) LIKE '%instagram%' OR LOWER(cla.action_type) LIKE '%instagram%') THEN cla.id END) as instagram_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' AND (LOWER(cla.channel) = 'instagram' OR LOWER(cla.step_type) LIKE '%instagram%' OR LOWER(cla.action_type) LIKE '%instagram%') THEN cla.id END) as instagram_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' AND (LOWER(cla.channel) = 'whatsapp' OR LOWER(cla.step_type) LIKE '%whatsapp%' OR LOWER(cla.action_type) LIKE '%whatsapp%') THEN cla.id END) as whatsapp_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' AND (LOWER(cla.channel) = 'whatsapp' OR LOWER(cla.step_type) LIKE '%whatsapp%' OR LOWER(cla.action_type) LIKE '%whatsapp%') THEN cla.id END) as whatsapp_connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' AND (LOWER(cla.channel) = 'voice' OR LOWER(cla.step_type) LIKE '%voice%' OR LOWER(cla.action_type) LIKE '%voice%' OR LOWER(cla.step_type) = 'voice_agent_call') THEN cla.id END) as voice_sent,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' AND (LOWER(cla.channel) = 'voice' OR LOWER(cla.step_type) LIKE '%voice%' OR LOWER(cla.action_type) LIKE '%voice%' OR LOWER(cla.step_type) = 'voice_agent_call') THEN cla.id END) as voice_connected
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      LEFT JOIN campaign_lead_activities cla ON cl.id = cla.campaign_lead_id
      WHERE c.is_deleted = FALSE
    `;
    const params = [];
    let paramIndex = 1;

    if (orgId) {
      query += ` AND c.organization_id = $${paramIndex++}`;
      params.push(orgId);
    } else if (userId) {
      query += ` AND c.created_by = $${paramIndex++}`;
      params.push(userId);
    }

    const result = await pool.query(query, params);
    const stats = result.rows[0] || {};

    // Calculate rates
    const totalSent = parseInt(stats.total_sent) || 0;
    const totalConnected = parseInt(stats.total_connected) || 0;
    const totalReplied = parseInt(stats.total_replied) || 0;

    const avgConnectionRate = totalSent > 0 ? (totalConnected / totalSent) * 100 : 0;
    const avgReplyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    // Calculate platform-specific connection rates
    const instagramSent = parseInt(stats.instagram_sent) || 0;
    const instagramConnected = parseInt(stats.instagram_connected) || 0;
    const instagramConnectionRate = instagramSent > 0 ? (instagramConnected / instagramSent) * 100 : 0;

    const whatsappSent = parseInt(stats.whatsapp_sent) || 0;
    const whatsappConnected = parseInt(stats.whatsapp_connected) || 0;
    const whatsappConnectionRate = whatsappSent > 0 ? (whatsappConnected / whatsappSent) * 100 : 0;

    const voiceSent = parseInt(stats.voice_sent) || 0;
    const voiceConnected = parseInt(stats.voice_connected) || 0;
    const voiceConnectionRate = voiceSent > 0 ? (voiceConnected / voiceSent) * 100 : 0;

    const responseData = {
      total_campaigns: parseInt(stats.total_campaigns) || 0,
      active_campaigns: parseInt(stats.active_campaigns) || 0,
      total_leads: parseInt(stats.total_leads) || 0,
      total_sent: totalSent,
      total_delivered: parseInt(stats.total_delivered) || 0,
      total_connected: totalConnected,
      total_replied: totalReplied,
      avg_connection_rate: avgConnectionRate,
      avg_reply_rate: avgReplyRate,
      instagram_connection_rate: instagramConnectionRate,
      whatsapp_connection_rate: whatsappConnectionRate,
      voice_agent_connection_rate: voiceConnectionRate
    };
    
    console.log('[Campaigns Stats] Returning stats:', {
      instagram_rate: responseData.instagram_connection_rate,
      whatsapp_rate: responseData.whatsapp_connection_rate,
      voice_rate: responseData.voice_agent_connection_rate,
      instagram_sent: instagramSent,
      instagram_connected: instagramConnected,
      whatsapp_sent: whatsappSent,
      whatsapp_connected: whatsappConnected,
      voice_sent: voiceSent,
      voice_connected: voiceConnected
    });
    
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[Campaigns] Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign stats',
      message: error.message
    });
  }
});

/**
 * GET /api/campaigns/:id/analytics
 * Get campaign analytics
 */
router.get('/:id/analytics', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    // Get campaign
    let campaignQuery = `
      SELECT c.*, COUNT(DISTINCT cl.id) as leads_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      WHERE c.id = $1 AND c.is_deleted = FALSE
    `;
    const campaignParams = [id];

    if (orgId) {
      campaignQuery += ` AND c.organization_id = $2`;
      campaignParams.push(orgId);
    } else if (userId) {
      campaignQuery += ` AND c.created_by = $2`;
      campaignParams.push(userId);
    }

    campaignQuery += ` GROUP BY c.id`;

    const campaignResult = await pool.query(campaignQuery, campaignParams);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const campaign = campaignResult.rows[0];

    // Get campaign analytics
    const analyticsQuery = `
      SELECT 
        COUNT(DISTINCT cl.id) as total_leads,
        COUNT(DISTINCT CASE WHEN cl.status = 'active' THEN cl.id END) as active_leads,
        COUNT(DISTINCT CASE WHEN cl.status = 'completed' THEN cl.id END) as completed_leads,
        COUNT(DISTINCT CASE WHEN cl.status = 'stopped' THEN cl.id END) as stopped_leads,
        COUNT(DISTINCT cla.id) as total_activities,
        COUNT(DISTINCT CASE WHEN cla.status = 'sent' THEN cla.id END) as sent_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'opened' THEN cla.id END) as opened_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'clicked' THEN cla.id END) as clicked_count,
        COUNT(DISTINCT CASE WHEN cla.status = 'error' THEN cla.id END) as error_count,
        -- Lead generation specific
        COUNT(DISTINCT CASE WHEN cla.step_type = 'lead_generation' AND cla.status = 'sent' THEN cla.id END) as leads_generated,
        -- LinkedIn connection requests
        COUNT(DISTINCT CASE WHEN cla.step_type = 'linkedin_connect' AND cla.status = 'sent' THEN cla.id END) as connection_requests_sent,
        COUNT(DISTINCT CASE WHEN cla.step_type = 'linkedin_connect' AND cla.status = 'connected' THEN cla.id END) as connection_requests_accepted,
        -- LinkedIn messages
        COUNT(DISTINCT CASE WHEN cla.step_type = 'linkedin_message' AND cla.status = 'sent' THEN cla.id END) as linkedin_messages_sent,
        COUNT(DISTINCT CASE WHEN cla.step_type = 'linkedin_message' AND cla.status = 'replied' THEN cla.id END) as linkedin_messages_replied,
        -- Voice agent calls
        COUNT(DISTINCT CASE WHEN cla.step_type = 'voice_agent_call' AND cla.status = 'sent' THEN cla.id END) as voice_calls_made,
        COUNT(DISTINCT CASE WHEN cla.step_type = 'voice_agent_call' AND cla.status = 'connected' THEN cla.id END) as voice_calls_answered
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      LEFT JOIN campaign_lead_activities cla ON cl.id = cla.campaign_lead_id
      WHERE c.id = $1
    `;

    const analyticsResult = await pool.query(analyticsQuery, [id]);
    const analytics = analyticsResult.rows[0] || {};

    // Calculate rates
    const sent = parseInt(analytics.sent_count) || 0;
    const delivered = parseInt(analytics.delivered_count) || 0;
    const connected = parseInt(analytics.connected_count) || 0;
    const replied = parseInt(analytics.replied_count) || 0;
    const opened = parseInt(analytics.opened_count) || 0;
    const clicked = parseInt(analytics.clicked_count) || 0;

    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;
    const connectionRate = sent > 0 ? (connected / sent) * 100 : 0;
    const replyRate = sent > 0 ? (replied / sent) * 100 : 0;
    const openRate = delivered > 0 ? (opened / delivered) * 100 : 0;
    const clickRate = delivered > 0 ? (clicked / delivered) * 100 : 0;

    // Get step-by-step analytics
    // Note: "sent" counts all activities that exist (since all start as 'sent')
    // This shows total attempts, even if they later become 'error' or 'delivered'
    const stepAnalyticsQuery = `
      SELECT 
        cs.id,
        cs.type,
        cs.title,
        cs."order",
        COUNT(DISTINCT cla.id) as total_executions,
        COUNT(DISTINCT cla.id) as sent,  -- All activities started as 'sent', so total_executions = sent
        COUNT(DISTINCT CASE WHEN cla.status = 'delivered' THEN cla.id END) as delivered,
        COUNT(DISTINCT CASE WHEN cla.status = 'connected' THEN cla.id END) as connected,
        COUNT(DISTINCT CASE WHEN cla.status = 'replied' THEN cla.id END) as replied,
        COUNT(DISTINCT CASE WHEN cla.status = 'error' THEN cla.id END) as errors
      FROM campaign_steps cs
      LEFT JOIN campaign_leads cl ON cs.campaign_id = cl.campaign_id
      LEFT JOIN campaign_lead_activities cla ON cl.id = cla.campaign_lead_id AND cla.step_id = cs.id
      WHERE cs.campaign_id = $1
      GROUP BY cs.id, cs.type, cs.title, cs."order"
      ORDER BY cs."order" ASC
    `;

    const stepAnalyticsResult = await pool.query(stepAnalyticsQuery, [id]);

    res.json({
      success: true,
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          created_at: campaign.created_at,
        },
        overview: {
          total_leads: parseInt(analytics.total_leads) || 0,
          active_leads: parseInt(analytics.active_leads) || 0,
          completed_leads: parseInt(analytics.completed_leads) || 0,
          stopped_leads: parseInt(analytics.stopped_leads) || 0,
        },
        metrics: {
          sent: sent,
          delivered: delivered,
          connected: connected,
          replied: replied,
          opened: opened,
          clicked: clicked,
          errors: parseInt(analytics.error_count) || 0,
          // Step-specific metrics
          leads_generated: parseInt(analytics.leads_generated) || 0,
          connection_requests_sent: parseInt(analytics.connection_requests_sent) || 0,
          connection_requests_accepted: parseInt(analytics.connection_requests_accepted) || 0,
          linkedin_messages_sent: parseInt(analytics.linkedin_messages_sent) || 0,
          linkedin_messages_replied: parseInt(analytics.linkedin_messages_replied) || 0,
          voice_calls_made: parseInt(analytics.voice_calls_made) || 0,
          voice_calls_answered: parseInt(analytics.voice_calls_answered) || 0,
        },
        rates: {
          delivery_rate: deliveryRate,
          connection_rate: connectionRate,
          reply_rate: replyRate,
          open_rate: openRate,
          click_rate: clickRate,
        },
        step_analytics: stepAnalyticsResult.rows,
      }
    });
  } catch (error) {
    console.error('[Campaigns] Error getting analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign analytics',
      message: error.message
    });
  }
});

/**
 * GET /api/campaigns/:id/leads
 * Get campaign leads
 */
router.get('/:id/leads', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;
    const { page = 1, limit = 50, status } = req.query;

    // Verify campaign exists and user has access
    let campaignQuery = `
      SELECT c.*
      FROM campaigns c
      WHERE c.id = $1 AND c.is_deleted = FALSE
    `;
    const campaignParams = [id];

    if (orgId) {
      campaignQuery += ` AND c.organization_id = $2`;
      campaignParams.push(orgId);
    } else if (userId) {
      campaignQuery += ` AND c.created_by = $2`;
      campaignParams.push(userId);
    }

    const campaignResult = await pool.query(campaignQuery, campaignParams);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Build leads query - handle lead_data column gracefully (it may not exist)
    // First check if lead_data column exists
    let hasLeadDataColumn = false;
    try {
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'campaign_leads' AND column_name = 'lead_data'
      `);
      hasLeadDataColumn = columnCheck.rows.length > 0;
    } catch (e) {
      // If check fails, assume column doesn't exist
      hasLeadDataColumn = false;
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build SELECT clause based on whether lead_data column exists
    let selectClause = `
      SELECT 
        cl.id,
        cl.campaign_id,
        cl.first_name,
        cl.last_name,
        cl.email,
        cl.phone,
        cl.linkedin_url,
        cl.company_name,
        cl.title,
        cl.status,
        cl.custom_fields,
        cl.created_at,
        cl.updated_at
    `;
    
    // Conditionally add lead_data if column exists
    if (hasLeadDataColumn) {
      selectClause += `, cl.lead_data`;
    }
    
    // Build name COALESCE - use lead_data if available, otherwise just use first/last name
    let nameExpression = `COALESCE(
      NULLIF(TRIM(cl.first_name || ' ' || cl.last_name), ''),
      cl.first_name,
      cl.last_name,
      'Unknown'
    )`;
    
    if (hasLeadDataColumn) {
      nameExpression = `COALESCE(
        NULLIF(TRIM(cl.first_name || ' ' || cl.last_name), ''),
        cl.lead_data->>'name',
        cl.lead_data->>'employee_name',
        cl.lead_data->>'fullname',
        cl.first_name,
        cl.last_name,
        'Unknown'
      )`;
    }
    
    selectClause += `, ${nameExpression} as name`;
    
    let leadsQuery = selectClause + `
      FROM campaign_leads cl
      WHERE cl.campaign_id = $1
    `;
    const leadsParams = [id];
    let paramIndex = 2;

    if (status && status !== 'all') {
      leadsQuery += ` AND cl.status = $${paramIndex++}`;
      leadsParams.push(status);
    }

    // Get total count
    const countQuery = leadsQuery.replace(
      /SELECT[\s\S]*FROM campaign_leads cl/,
      'SELECT COUNT(*) as total FROM campaign_leads cl'
    );
    const countResult = await pool.query(countQuery, leadsParams);
    const total = parseInt(countResult.rows[0].total) || 0;

    // Add pagination
    leadsQuery += ` ORDER BY cl.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    leadsParams.push(parseInt(limit), offset);

    const leadsResult = await pool.query(leadsQuery, leadsParams);

    // Transform leads to consistent format
    // NOTE: Photo URLs are stored in:
    // 1. lead_data.photo_url (if lead_data column exists) - Apollo returns photo_url field
    // 2. custom_fields.photo_url (if lead_data column doesn't exist - fallback) - same employee data stored here
    const leads = leadsResult.rows.map((lead, index) => {
      // Parse lead_data if it's a string, otherwise use as-is
      let leadData = {};
      if (hasLeadDataColumn && lead.lead_data) {
        if (typeof lead.lead_data === 'string') {
          try {
            leadData = JSON.parse(lead.lead_data);
          } catch (e) {
            console.error(`[Campaign Leads] Error parsing lead_data for lead ${lead.id}:`, e.message);
            leadData = {};
          }
        } else {
          leadData = lead.lead_data;
        }
      }
      // Parse custom_fields if it's a string, otherwise use as-is
      let customFields = {};
      if (lead.custom_fields) {
        if (typeof lead.custom_fields === 'string') {
          try {
            customFields = JSON.parse(lead.custom_fields);
          } catch (e) {
            console.error(`[Campaign Leads] Error parsing custom_fields for lead ${lead.id}:`, e.message);
            customFields = {};
          }
        } else {
          customFields = lead.custom_fields;
        }
      }
      
      // Extract photo URL from various possible fields (photo_url is what Apollo returns)
      // Check both lead_data and custom_fields since leads might be stored in custom_fields if lead_data column doesn't exist
      const photoUrl = leadData.photo_url  // Apollo uses photo_url (from lead_data)
        || customFields.photo_url  // Also check custom_fields
        || leadData.employee_photo_url
        || customFields.employee_photo_url
        || leadData.profile_picture_url
        || customFields.profile_picture_url
        || leadData.avatar
        || customFields.avatar
        || leadData.profile_image 
        || customFields.profile_image
        || leadData.avatar_url
        || customFields.avatar_url
        || leadData.profileImage
        || customFields.profileImage
        || null;
      
      // Log first lead for debugging
      if (index === 0) {
        console.log('[Campaign Leads] First lead photo extraction:', {
          'lead.id': lead.id,
          'hasLeadDataColumn': hasLeadDataColumn,
          'leadData keys': Object.keys(leadData).slice(0, 10),
          'customFields keys': Object.keys(customFields).slice(0, 10),
          'leadData.photo_url': leadData.photo_url,
          'customFields.photo_url': customFields.photo_url,
          'final photoUrl': photoUrl,
        });
      }
      
      return {
        id: lead.id,
        campaign_id: lead.campaign_id,
        name: lead.name || lead.first_name || (leadData.name || leadData.employee_name || leadData.fullname || '') || 'Unknown',
        first_name: lead.first_name || (leadData.first_name || '') || '',
        last_name: lead.last_name || (leadData.last_name || '') || '',
        email: lead.email || (leadData.email || '') || customFields.email || '',
        phone: lead.phone || (leadData.phone || '') || customFields.phone || '',
        linkedin_url: lead.linkedin_url || (leadData.linkedin_url || leadData.employee_linkedin_url || '') || '',
        company: lead.company_name || (leadData.company_name || leadData.company || '') || '',
        title: lead.title || (leadData.title || leadData.employee_title || '') || '',
        photo_url: photoUrl,
        status: lead.status || 'active',
        created_at: lead.created_at,
        updated_at: lead.updated_at,
        // Include raw data for reference
        lead_data: leadData,
        custom_fields: customFields
      };
    });

    res.json({
      success: true,
      data: leads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Campaigns] Error getting leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign leads',
      message: error.message
    });
  }
});

/**
 * POST /api/campaigns/:id/start
 * Start a campaign
 */
router.post('/:id/start', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    let updateQuery = `
      UPDATE campaigns
      SET status = 'running', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('draft', 'paused') AND is_deleted = FALSE
    `;
    const params = [id];

    if (orgId) {
      updateQuery += ` AND organization_id = $2`;
      params.push(orgId);
    } else if (userId) {
      updateQuery += ` AND created_by = $2`;
      params.push(userId);
    }

    const result = await pool.query(updateQuery, params);

    if (result.rowCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'Campaign cannot be started'
      });
    }

    // Trigger campaign execution in background
    const campaignExecutionService = require('./services/CampaignExecutionService');
    // Process campaign asynchronously (don't wait for it)
    campaignExecutionService.processCampaign(id).catch(err => {
      console.error(`[Campaigns] Error processing campaign ${id} after start:`, err);
    });

    res.json({
      success: true,
      message: 'Campaign started successfully'
    });
  } catch (error) {
    console.error('[Campaigns] Error starting campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start campaign',
      message: error.message
    });
  }
});

/**
 * POST /api/campaigns/:id/pause
 * Pause a campaign
 */
router.post('/:id/pause', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    let updateQuery = `
      UPDATE campaigns
      SET status = 'paused', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'running' AND is_deleted = FALSE
    `;
    const params = [id];

    if (orgId) {
      updateQuery += ` AND organization_id = $2`;
      params.push(orgId);
    } else if (userId) {
      updateQuery += ` AND created_by = $2`;
      params.push(userId);
    }

    await pool.query(updateQuery, params);

    res.json({
      success: true,
      message: 'Campaign paused successfully'
    });
  } catch (error) {
    console.error('[Campaigns] Error pausing campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pause campaign',
      message: error.message
    });
  }
});

/**
 * POST /api/campaigns/:id/stop
 * Stop a campaign
 */
router.post('/:id/stop', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    let updateQuery = `
      UPDATE campaigns
      SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('running', 'paused') AND is_deleted = FALSE
    `;
    const params = [id];

    if (orgId) {
      updateQuery += ` AND organization_id = $2`;
      params.push(orgId);
    } else if (userId) {
      updateQuery += ` AND created_by = $2`;
      params.push(userId);
    }

    await pool.query(updateQuery, params);

    res.json({
      success: true,
      message: 'Campaign stopped successfully'
    });
  } catch (error) {
    console.error('[Campaigns] Error stopping campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop campaign',
      message: error.message
    });
  }
});

/**
 * GET /api/campaigns/:id
 * Get a single campaign with steps
 */
router.get('/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    // Get campaign
    let campaignQuery = `
      SELECT c.*, COUNT(DISTINCT cl.id) as leads_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      WHERE c.id = $1 AND c.is_deleted = FALSE
    `;
    const campaignParams = [id];

    if (orgId) {
      campaignQuery += ` AND c.organization_id = $2`;
      campaignParams.push(orgId);
    } else if (userId) {
      campaignQuery += ` AND c.created_by = $2`;
      campaignParams.push(userId);
    }

    campaignQuery += ` GROUP BY c.id`;

    const campaignResult = await pool.query(campaignQuery, campaignParams);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const campaign = campaignResult.rows[0];

    // Get campaign steps
    const stepsQuery = `
      SELECT * FROM campaign_steps
      WHERE campaign_id = $1
      ORDER BY "order" ASC
    `;
    const stepsResult = await pool.query(stepsQuery, [id]);
    campaign.steps = stepsResult.rows;

    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('[Campaigns] Error getting campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign',
      message: error.message
    });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post('/', jwtAuth, async (req, res) => {
  try {
    const { name, status = 'draft', steps = [] } = req.body;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name is required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID is required. Please ensure you are authenticated.'
      });
    }

    // Prepare campaign config if leads_per_day is provided
    let campaignConfig = {};
    if (req.body.leads_per_day !== undefined || req.body.config) {
      campaignConfig = {
        ...(req.body.config || {}),
        ...(req.body.leads_per_day !== undefined ? { leads_per_day: req.body.leads_per_day } : {})
      };
    }

    // Build insert query - try with config column first, fallback without it
    let insertQuery = `
      INSERT INTO campaigns (name, status, organization_id, created_by, config)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
    `;
    let insertParams = [name, status, orgId, userId, JSON.stringify(campaignConfig)];
    
    let result;
    try {
      result = await pool.query(insertQuery, insertParams);
    } catch (err) {
      // If config column doesn't exist, insert without it
      console.log('[Campaigns] Config column not available, inserting without it');
      insertQuery = `
        INSERT INTO campaigns (name, status, organization_id, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      insertParams = [name, status, orgId, userId];
      result = await pool.query(insertQuery, insertParams);
    }
    
    const campaign = result.rows[0];

    // Save steps if provided
    if (steps && Array.isArray(steps) && steps.length > 0) {
      try {
        // Check if campaign_steps table exists
        await pool.query('SELECT 1 FROM campaign_steps LIMIT 1');
        
        // Delete any existing steps (shouldn't be any for new campaign, but just in case)
        await pool.query('DELETE FROM campaign_steps WHERE campaign_id = $1', [campaign.id]);

        // Insert new steps
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepConfig = step.config || {};
          
          await pool.query(
            `INSERT INTO campaign_steps (campaign_id, type, "order", title, description, config)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              campaign.id,
              step.type || step.stepType,
              step.order !== undefined ? step.order : i,
              step.title || step.name || 'Step',
              step.description || '',
              JSON.stringify(stepConfig)
            ]
          );
        }
        
        console.log(`[Campaigns] Saved ${steps.length} steps for campaign ${campaign.id}`);
      } catch (stepsError) {
        // If campaign_steps table doesn't exist, log warning but don't fail
        console.warn('[Campaigns] Could not save steps (table may not exist):', stepsError.message);
      }
    }

    // Get campaign with steps
    try {
      const stepsQuery = `SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY "order" ASC`;
      const stepsResult = await pool.query(stepsQuery, [campaign.id]);
      campaign.steps = stepsResult.rows || [];
    } catch (stepsError) {
      campaign.steps = [];
    }

    res.status(201).json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('[Campaigns] Error creating campaign:', error);
    console.error('[Campaigns] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to create campaign',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * PUT /api/campaigns/:id
 * Update a campaign
 */
router.put('/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status, steps, config, leads_per_day } = req.body;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    // Get existing campaign config if config column exists
    let existingConfig = {};
    try {
      const existingCampaign = await pool.query(
        `SELECT config FROM campaigns WHERE id = $1`,
        [id]
      );
      if (existingCampaign.rows[0]?.config) {
        existingConfig = typeof existingCampaign.rows[0].config === 'string'
          ? JSON.parse(existingCampaign.rows[0].config)
          : existingCampaign.rows[0].config;
      }
    } catch (err) {
      // Config column might not exist, use empty object
      console.log('[Campaigns] Config column check failed, continuing without it');
    }

    // Merge config updates
    let updatedConfig = { ...existingConfig };
    if (config && typeof config === 'object') {
      updatedConfig = { ...updatedConfig, ...config };
    }
    if (leads_per_day !== undefined) {
      updatedConfig.leads_per_day = leads_per_day;
    }

    // Update campaign
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }

    if (status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(status);
    }

    // Update config if provided
    if (Object.keys(updatedConfig).length > 0 || config !== undefined || leads_per_day !== undefined) {
      try {
        updateFields.push(`config = $${paramIndex++}::jsonb`);
        updateValues.push(JSON.stringify(updatedConfig));
      } catch (err) {
        // Config column might not exist, skip it
        console.log('[Campaigns] Could not update config column');
      }
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(id);

      let updateQuery = `
        UPDATE campaigns
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex++} AND is_deleted = FALSE
      `;

      if (orgId) {
        updateQuery += ` AND organization_id = $${paramIndex++}`;
        updateValues.push(orgId);
      } else if (userId) {
        updateQuery += ` AND created_by = $${paramIndex++}`;
        updateValues.push(userId);
      }

      await pool.query(updateQuery, updateValues);
    }

    // Update steps if provided
    if (steps && Array.isArray(steps)) {
      // Delete existing steps
      await pool.query('DELETE FROM campaign_steps WHERE campaign_id = $1', [id]);

      // Insert new steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await pool.query(
          `INSERT INTO campaign_steps (campaign_id, type, "order", title, description, config)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            step.type,
            step.order || i,
            step.title,
            step.description || null,
            JSON.stringify(step.config || {})
          ]
        );
      }
    }

    // Return updated campaign with steps
    const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    const campaign = campaignResult.rows[0];

    // Get campaign steps
    const stepsQuery = `
      SELECT * FROM campaign_steps
      WHERE campaign_id = $1
      ORDER BY "order" ASC
    `;
    const stepsResult = await pool.query(stepsQuery, [id]);
    campaign.steps = stepsResult.rows;

    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('[Campaigns] Error updating campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update campaign',
      message: error.message
    });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign (soft delete)
 */
router.delete('/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id || req.user?.user_id;
    const orgId = req.user?.organization_id;

    let deleteQuery = `
      UPDATE campaigns
      SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND is_deleted = FALSE
    `;
    const params = [id];

    if (orgId) {
      deleteQuery += ` AND organization_id = $2`;
      params.push(orgId);
    } else if (userId) {
      deleteQuery += ` AND created_by = $2`;
      params.push(userId);
    }

    const result = await pool.query(deleteQuery, params);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('[Campaigns] Error deleting campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete campaign',
      message: error.message
    });
  }
});

module.exports = router;

