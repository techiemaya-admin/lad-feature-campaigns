/**
 * Campaign CRUD Controller
 * Handles basic CRUD operations for campaigns
 */
const CampaignModel = require('../models/CampaignModel');
const CampaignStepModel = require('../models/CampaignStepModel');
const CampaignExecutionService = require('../services/CampaignExecutionService');
const { campaignStatsTracker } = require('../services/campaignStatsTracker');
const { campaignEventsService } = require('../services/campaignEventsService');
const { pool } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');
const AIMessageDataService = require('../services/AIMessageDataFetcher');
const CampaignScheduleUtil = require('../utils/campaignScheduleUtil');
const CampaignSchedulingService = require('../services/CampaignMultiDateScheduler');
const { getCampaignCreditSummary } = require('../../../shared/middleware/credit_guard');

class CampaignCRUDController {
  /**
   * GET /api/campaigns
   * List all campaigns with stats
   */
  static async listCampaigns(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { search, status, limit, offset } = req.query;
      const campaigns = await CampaignModel.list(tenantId, {
        search,
        status,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0
      });
      // Fetch steps and real-time stats for each campaign
      const campaignsWithSteps = await Promise.all(
        campaigns.map(async (campaign) => {
          try {
            const steps = await CampaignStepModel.getStepsByCampaignId(campaign.id, tenantId);
            // Get real-time stats from campaign_analytics table
            let stats;
            try {
              stats = await campaignStatsTracker.getStats(campaign.id);
            } catch (statsError) {
              stats = {
                leads_count: parseInt(campaign.leads_count) || 0,
                sent_count: parseInt(campaign.sent_count) || 0,
                delivered_count: parseInt(campaign.delivered_count) || 0,
                connected_count: parseInt(campaign.connected_count) || 0,
                replied_count: parseInt(campaign.replied_count) || 0,
                opened_count: parseInt(campaign.opened_count) || 0,
                clicked_count: parseInt(campaign.clicked_count) || 0,
                platform_metrics: null
              };
            }
            
            // Get credit usage data from campaign metadata
            // Debug: Log metadata to check if it's being retrieved
            logger.debug('[Campaign List] Processing campaign credits', {
              campaignId: campaign.id,
              campaignName: campaign.name,
              hasMetadata: !!campaign.metadata,
              metadataType: typeof campaign.metadata,
              metadata: campaign.metadata,
              creditsValue: campaign.metadata?.total_credits_deducted
            });
            
            let creditData = {
              total_credits_deducted: parseFloat(campaign.metadata?.total_credits_deducted) || 0,
              last_credit_update: campaign.metadata?.last_credit_update || null
            };
            
            return {
              ...campaign,
              steps: steps || [],
              ...stats,
              credits: creditData,
              total_credits_deducted: creditData.total_credits_deducted,
              last_credit_update: creditData.last_credit_update
            };
          } catch (error) {
            return {
              ...campaign,
              steps: [],
              leads_count: parseInt(campaign.leads_count) || 0,
              sent_count: parseInt(campaign.sent_count) || 0,
              delivered_count: parseInt(campaign.delivered_count) || 0,
              connected_count: parseInt(campaign.connected_count) || 0,
              replied_count: parseInt(campaign.replied_count) || 0,
              opened_count: parseInt(campaign.opened_count) || 0,
              clicked_count: parseInt(campaign.clicked_count) || 0,
              platform_metrics: null,
              credits: {
                total_credits_deducted: parseFloat(campaign.metadata?.total_credits_deducted) || 0,
                last_credit_update: campaign.metadata?.last_credit_update || null
              },
              total_credits_deducted: parseFloat(campaign.metadata?.total_credits_deducted) || 0,
              last_credit_update: campaign.metadata?.last_credit_update || null
            };
          }
        })
      );

      res.json({
        success: true,
        data: campaignsWithSteps
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to list campaigns',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  /**
   * GET /api/campaigns/stats
   * Get campaign statistics
   */
  static async getCampaignStats(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const stats = await CampaignModel.getStats(tenantId);
      // Handle empty results from database (mock DB or no data)
      if (!stats) {
        return res.json({
          success: true,
          data: {
            total_campaigns: 0,
            active_campaigns: 0,
            total_leads: 0,
            total_sent: 0,
            total_delivered: 0,
            total_connected: 0,
            total_replied: 0
          }
        });
      }
      res.json({
        success: true,
        data: {
          total_campaigns: parseInt(stats.total_campaigns) || 0,
          active_campaigns: parseInt(stats.active_campaigns) || 0,
          total_leads: parseInt(stats.total_leads) || 0,
          total_sent: parseInt(stats.total_sent) || 0,
          total_delivered: parseInt(stats.total_delivered) || 0,
          total_connected: parseInt(stats.total_connected) || 0,
          total_replied: parseInt(stats.total_replied) || 0
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign stats',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  /**
   * GET /api/campaigns/:id
   * Get campaign by ID
   */
  static async getCampaignById(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const campaign = await CampaignModel.getById(id, tenantId);
      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }
      // Get steps
      const steps = await CampaignStepModel.getStepsByCampaignId(id, tenantId);
      res.json({
        success: true,
        data: {
          ...campaign,
          steps: steps || []
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign',
        message: error.message
      });
    }
  }
  /**
   * POST /api/campaigns
   * Create a new campaign
   */
  static async createCampaign(req, res) {
    logger.info('[CampaignCreate] CREATE CAMPAIGN REQUEST RECEIVED', {
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      hasUser: !!req.user,
      userKeys: req.user ? Object.keys(req.user) : []
    });
    
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.userId || req.user?.user_id || req.user?.id;
      
      logger.info('[CampaignCreate] Authentication context', {
        tenantId,
        userId,
        hasAuth: !!(tenantId && userId)
      });
      
      // Validate authentication
      if (!tenantId) {
        logger.error('[CampaignCreate] Missing tenant ID');
        return res.status(401).json({
          success: false,
          error: 'Tenant ID is required. Please ensure you are authenticated.'
        });
      }
      if (!userId) {
        logger.error('[CampaignCreate] Missing user ID');
        return res.status(401).json({
          success: false,
          error: 'User ID is required. Please ensure you are authenticated.'
        });
      }
      const { name, status, config, steps, campaign_type, leads_per_day, inbound_lead_ids, campaign_start_date, campaign_end_date, conversationId } = req.body;
      
      logger.info('[CampaignCreate] Request payload parsed', {
        name,
        status,
        hasConfig: !!config,
        hasSteps: !!(steps && steps.length),
        stepsCount: steps?.length,
        campaign_type,
        leads_per_day,
        hasInboundLeads: !!(inbound_lead_ids && inbound_lead_ids.length),
        campaign_start_date,
        campaign_end_date,
        conversationId,
        hasConversationId: !!conversationId
      });

      // Validate required fields
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Campaign name is required'
        });
      }

      // Fetch message_data from ai_messages if conversationId is provided
      let messageData = null;
      let calculatedDates = null;
      
      if (conversationId) {
        try {
          logger.info('[CampaignCreate] Fetching message_data from ai_messages', {
            conversationId,
            tenantId
          });

          messageData = await AIMessageDataService.fetchMessageDataByConversation(
            conversationId,
            tenantId
          );

          if (messageData) {
            // Calculate campaign dates from message_data using utility
            calculatedDates = CampaignScheduleUtil.calculateCampaignDates(messageData);
            
            logger.info('[CampaignCreate] Campaign dates calculated from message_data', {
              conversationId,
              startDate: calculatedDates.startDate.toISOString(),
              endDate: calculatedDates.endDate.toISOString(),
              totalScheduleDates: calculatedDates.scheduleDates.length,
              workingDays: calculatedDates.workingDaysStr
            });
          } else {
            logger.warn('[CampaignCreate] No message_data found for conversationId, will use provided dates', {
              conversationId,
              tenantId
            });
          }
        } catch (error) {
          logger.error('[CampaignCreate] Error fetching/calculating dates from message_data', {
            conversationId,
            tenantId,
            error: error.message,
            stack: error.stack
          });
          // Continue with provided dates if message_data fetch fails
        }
      }
      
      // Store campaign_type in config
      const campaignConfig = config || {};
      if (campaign_type) {
        campaignConfig.campaign_type = campaign_type;
      }
      // Merge leads_per_day from top level if provided (for backwards compatibility)
      if (leads_per_day !== undefined) {
        campaignConfig.leads_per_day = leads_per_day;
      }
      
      // Use calculated dates from message_data, or fall back to provided dates
      const finalStartDate = calculatedDates?.startDate || campaign_start_date;
      const finalEndDate = calculatedDates?.endDate || campaign_end_date;
      
      // Add campaign dates to config if provided or calculated
      if (finalStartDate) {
        campaignConfig.campaign_start_date = finalStartDate;
      }
      if (finalEndDate) {
        campaignConfig.campaign_end_date = finalEndDate;
      }
      
      // Store conversationId and schedule metadata in config
      if (conversationId) {
        campaignConfig.conversationId = conversationId;
      }
      if (calculatedDates) {
        campaignConfig.working_days = calculatedDates.workingDaysStr;
        campaignConfig.total_schedule_dates = calculatedDates.scheduleDates.length;
      }
      
      logger.info('[CampaignCreate] Creating campaign with config', {
        tenantId,
        hasStartDate: !!finalStartDate,
        hasEndDate: !!finalEndDate,
        hasConversationId: !!conversationId,
        hasCalculatedDates: !!calculatedDates,
        configKeys: Object.keys(campaignConfig)
      });
      
      // Calculate campaign duration if we have dates
      let campaignDurationDays = null;
      if (finalStartDate && finalEndDate) {
        const start = new Date(finalStartDate);
        const end = new Date(finalEndDate);
        campaignDurationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      }
      
      // Map frontend status 'active' to database status 'running'
      // Frontend uses: draft, active, paused, completed, stopped
      // Database uses: draft, running, paused, completed, stopped
      const dbStatus = status === 'active' ? 'running' : (status || 'draft');
      
      // Create campaign with schedule data
      const campaign = await CampaignModel.create({
        name,
        status: dbStatus,
        createdBy: userId,
        config: campaignConfig,
        inbound_lead_ids,  // Pass inbound lead IDs to model
        campaign_start_date: finalStartDate || null,
        campaign_end_date: finalEndDate || null,
        campaign_duration_days: campaignDurationDays,
        working_days: calculatedDates?.workingDaysStr || null
      }, tenantId);
      
      logger.info('[CampaignCreate] Campaign created', { 
        campaignId: campaign.id, 
        tenantId,
        hasSteps: !!(steps && Array.isArray(steps) && steps.length > 0),
        stepsCount: steps?.length || 0
      });
      
      // Create steps if provided
      let createdSteps = [];
      if (steps && Array.isArray(steps) && steps.length > 0) {
        try {
          // Map step_type to type and step_order to order for database compatibility
          const mappedSteps = steps.map(step => ({
            ...step,
            type: step.step_type || step.type,
            order: step.step_order ?? step.order ?? 0
          }));
          
          logger.debug('[CampaignCreate] Creating campaign steps', { 
            campaignId: campaign.id,
            stepCount: mappedSteps.length,
            stepTypes: mappedSteps.map(s => s.type)
          });
          createdSteps = await CampaignStepModel.bulkCreate(campaign.id, tenantId, mappedSteps);
          logger.info('[CampaignCreate] Steps created successfully', { 
            campaignId: campaign.id,
            createdCount: createdSteps.length 
          });
        } catch (stepError) {
          logger.error('[CampaignCreate] Failed to create campaign steps', {
            error: stepError.message,
            stack: stepError.stack,
            campaignId: campaign.id,
            stepCount: steps.length
          });
          // Continue anyway - campaign is created, just without steps
        }
      } else {
        logger.warn('[CampaignCreate] No steps provided or steps array is empty', {
          campaignId: campaign.id,
          stepsType: typeof steps,
          isArray: Array.isArray(steps),
          stepsLength: steps?.length
        });
      }
      // NOTE: Inbound leads are already linked by CampaignModel.create() when inbound_lead_ids is passed
      // No need to link them again here to avoid duplicates
      
      // Schedule Cloud Tasks if we have calculated dates from message_data
      if (calculatedDates && calculatedDates.scheduleDates && calculatedDates.scheduleDates.length > 0) {
        try {
          logger.info('[CampaignCreate] Scheduling Cloud Tasks for calculated dates', {
            campaignId: campaign.id,
            tenantId,
            totalDates: calculatedDates.scheduleDates.length,
            firstDate: calculatedDates.scheduleDates[0].toISOString(),
            lastDate: calculatedDates.scheduleDates[calculatedDates.scheduleDates.length - 1].toISOString()
          });
          const schedulingResult = await CampaignSchedulingService.scheduleTasksForDates(
            campaign.id,
            tenantId,
            calculatedDates.scheduleDates
          );
          
          logger.info('🔍 [DEBUG BACKEND] Cloud Tasks scheduled:', {
            totalScheduled: schedulingResult.totalScheduled,
            totalFailed: schedulingResult.totalFailed
          });

          logger.info('[CampaignCreate] Cloud Tasks scheduling completed', {
            campaignId: campaign.id,
            tenantId,
            totalScheduled: schedulingResult.totalScheduled,
            totalFailed: schedulingResult.totalFailed
          });

          // Store scheduling result in campaign config for reference
          await CampaignModel.update(campaign.id, tenantId, {
            config: {
              ...campaignConfig,
              scheduling_result: {
                totalScheduled: schedulingResult.totalScheduled,
                totalFailed: schedulingResult.totalFailed,
                scheduledAt: new Date().toISOString()
              }
            }
          });
        } catch (schedulingError) {
          logger.error('[CampaignCreate] Error scheduling Cloud Tasks', {
            campaignId: campaign.id,
            tenantId,
            error: schedulingError.message,
            stack: schedulingError.stack
          });
          // Continue anyway - campaign is created, tasks can be rescheduled later
        }
      }
      
      // If campaign is created with status='running' (mapped from 'active'), trigger immediate lead generation
      // This ensures leads are scraped right away when campaign is created and started
      if (campaign.status === 'running' || status === 'active') {

        // Set execution_state to active for immediate processing
        try {
          await CampaignModel.updateExecutionState(campaign.id, 'active', {
            lastExecutionReason: 'Campaign created and started immediately'
          });
        } catch (stateError) {
          // If execution_state columns don't exist, continue anyway
        }
        // Extract auth token from request headers
        const authToken = req.headers.authorization 
          ? req.headers.authorization.replace('Bearer ', '').trim()
          : null;

        // Trigger campaign execution immediately (fire and forget)
        CampaignExecutionService.processCampaign(campaign.id, tenantId, authToken)
          .then(async (result) => {

            // ✅ ALWAYS emit SSE event after processCampaign completes (whether success, skipped, or error)
            // This ensures UI updates even if campaign was skipped or had no leads
            try {
              const stats = await campaignStatsTracker.getStats(campaign.id);
              await campaignEventsService.publishCampaignListUpdate(campaign.id, stats);

            } catch (sseError) {
            }
          })
          .catch(err => {
            logger.error('[CampaignCreate] Campaign processing failed', { 
              campaignId: campaign.id,
              tenantId,
              error: err.message,
              stack: err.stack
            });

            // Even on error, try to emit SSE so UI shows current state
            campaignStatsTracker.getStats(campaign.id)
              .then(stats => {
                campaignEventsService.publishCampaignListUpdate(campaign.id, stats);
              })
              .catch(sseErr => {});
          });
      } else {
        // If campaign is NOT running, emit SSE immediately (no leads to wait for)
        try {
          const stats = await campaignStatsTracker.getStats(campaign.id);
          await campaignEventsService.publishCampaignListUpdate(campaign.id, stats);
        } catch (sseError) {
        }
      }
      // ✅ Remove the old SSE emission that was happening too early
      res.status(201).json({
        success: true,
        data: {
          ...campaign,
          campaign_type: campaignConfig.campaign_type || 'linkedin_outreach',
          steps: createdSteps
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create campaign',
        message: error.message
      });
    }
  }
  /**
   * PATCH /api/campaigns/:id
   * Update campaign
   */
  static async updateCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const updates = req.body;
      const campaign = await CampaignModel.update(id, tenantId, updates);
      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }
      res.json({
        success: true,
        data: campaign
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update campaign',
        message: error.message
      });
    }
  }
  /**
   * DELETE /api/campaigns/:id
   * Delete campaign (soft delete)
   */
  static async deleteCampaign(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const result = await CampaignModel.delete(id, tenantId);
      if (!result) {
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
      res.status(500).json({
        success: false,
        error: 'Failed to delete campaign',
        message: error.message
      });
    }
  }
}
module.exports = CampaignCRUDController;
