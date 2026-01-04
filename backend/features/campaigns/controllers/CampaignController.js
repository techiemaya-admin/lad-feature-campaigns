/**
 * Campaign Controller
 * Main facade that combines all campaign controllers
 * This file maintains backward compatibility while delegating to split controllers
 */

// Import all controllers
const CampaignCRUDController = require('./CampaignCRUDController');
const CampaignActionsController = require('./CampaignActionsController');
const CampaignLeadsController = require('./CampaignLeadsController');
const CampaignLeadsSummaryController = require('./CampaignLeadsSummaryController');
const CampaignLeadsRevealController = require('./CampaignLeadsRevealController');
const CampaignStepsController = require('./CampaignStepsController');
const logger = require('../../../../core/utils/logger');

class CampaignController {
  // CRUD methods - delegate to CampaignCRUDController
  static async listCampaigns(req, res) {
    return CampaignCRUDController.listCampaigns(req, res);
  }

  static async getCampaignStats(req, res) {
    return CampaignCRUDController.getCampaignStats(req, res);
  }

  static async getCampaignById(req, res) {
    return CampaignCRUDController.getCampaignById(req, res);
  }

  static async createCampaign(req, res) {
    return CampaignCRUDController.createCampaign(req, res);
  }

  static async updateCampaign(req, res) {
    return CampaignCRUDController.updateCampaign(req, res);
  }

  static async deleteCampaign(req, res) {
    return CampaignCRUDController.deleteCampaign(req, res);
  }

  // Leads methods - delegate to CampaignLeadsController
  static async getCampaignLeads(req, res) {
    return CampaignLeadsController.getCampaignLeads(req, res);
  }

  static async addLeadsToCampaign(req, res) {
    return CampaignLeadsController.addLeadsToCampaign(req, res);
  }

  static async getLeadSummary(req, res) {
    return CampaignLeadsSummaryController.getLeadSummary(req, res);
  }

  static async generateLeadSummary(req, res) {
    return CampaignLeadsSummaryController.generateLeadSummary(req, res);
  }

  static async revealLeadEmail(req, res) {
    return CampaignLeadsRevealController.revealLeadEmail(req, res);
  }

  static async revealLeadPhone(req, res) {
    return CampaignLeadsRevealController.revealLeadPhone(req, res);
  }

  static async getCampaignActivities(req, res) {
    return CampaignLeadsController.getCampaignActivities(req, res);
  }

  static async revealLeadEmail(req, res) {
    return CampaignLeadsController.revealLeadEmail(req, res);
  }

  static async revealLeadPhone(req, res) {
    return CampaignLeadsController.revealLeadPhone(req, res);
  }

  // Actions methods - delegate to CampaignActionsController
  static async startCampaign(req, res) {
    return CampaignActionsController.startCampaign(req, res);
  }

  static async pauseCampaign(req, res) {
    return CampaignActionsController.pauseCampaign(req, res);
  }

  static async stopCampaign(req, res) {
    return CampaignActionsController.stopCampaign(req, res);
  }

  // Steps methods - delegate to CampaignStepsController
  static async getCampaignSteps(req, res) {
    return CampaignStepsController.getCampaignSteps(req, res);
  }

  static async updateCampaignSteps(req, res) {
    return CampaignStepsController.updateCampaignSteps(req, res);
  }

  // Analytics method
  static async getCampaignAnalytics(req, res) {
    const CampaignModel = require('../models/CampaignModel');
    const CampaignStepModel = require('../models/CampaignStepModel');
    const CampaignLeadModel = require('../models/CampaignLeadModel');

    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;

      // Get campaign
      const campaign = await CampaignModel.getById(id, tenantId);

      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: 'Campaign not found'
        });
      }

      // Get campaign steps
      const steps = await CampaignStepModel.getStepsByCampaignId(id, tenantId);

      // Get leads for this campaign
      const leads = await CampaignLeadModel.getByCampaignId(id, tenantId);

      // Calculate analytics
      const totalLeads = leads.length;
      const contacted = leads.filter(l => l.status === 'contacted' || l.status === 'replied').length;
      const replied = leads.filter(l => l.status === 'replied').length;
      const connected = leads.filter(l => l.linkedin_connected || l.status === 'connected').length;

      const contactRate = totalLeads > 0 ? (contacted / totalLeads) * 100 : 0;
      const replyRate = contacted > 0 ? (replied / contacted) * 100 : 0;
      const connectionRate = totalLeads > 0 ? (connected / totalLeads) * 100 : 0;

      // Calculate lead statuses
      const activeLeads = leads.filter(l => 
        l.status === 'pending' || l.status === 'in_progress' || l.status === 'contacted'
      ).length;
      const completedLeads = leads.filter(l => 
        l.status === 'replied' || l.status === 'converted'
      ).length;
      const stoppedLeads = leads.filter(l => 
        l.status === 'stopped' || l.status === 'failed' || l.status === 'bounced'
      ).length;

      // Generate step analytics from campaign steps
      const stepAnalytics = [];
      if (steps && Array.isArray(steps)) {
        steps.forEach((step, index) => {
          // Get step type mapping
          const stepTypeMap = {
            'lead_generation': 'Lead Generation',
            'linkedin_visit': 'Visit LinkedIn Profile',
            'linkedin_follow': 'Follow LinkedIn Profile',
            'linkedin_connect': 'Send Connection Request',
            'linkedin_message': 'LinkedIn Message',
            'email': 'Email',
            'whatsapp': 'WhatsApp Message',
            'voice_agent': 'Voice Call',
          };

          // Count executions for this step (using lead status or step tracking if available)
          const stepExecutions = totalLeads; // Simplified: assume all leads go through all steps
          
          stepAnalytics.push({
            id: step.id || `step-${index}`,
            type: step.type || 'unknown',
            title: stepTypeMap[step.type] || step.name || `Step ${index + 1}`,
            order: index,
            total_executions: stepExecutions,
            sent: step.type === 'lead_generation' ? totalLeads : 0,
            delivered: 0,
            connected: step.type === 'linkedin_connect' ? connected : 0,
            replied: step.type === 'linkedin_message' || step.type === 'email' ? replied : 0,
            errors: 0
          });
        });
      }

      res.json({
        success: true,
        data: {
          campaign: {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            created_at: campaign.created_at
          },
          overview: {
            total_leads: totalLeads,
            active_leads: activeLeads,
            completed_leads: completedLeads,
            stopped_leads: stoppedLeads,
            sent: contacted,
            delivered: contacted,
            opened: 0,
            clicked: 0,
            connected: connected,
            replied: replied
          },
          metrics: {
            delivery_rate: contactRate,
            open_rate: 0,
            click_rate: 0,
            connection_rate: connectionRate,
            reply_rate: replyRate,
            leads_generated: totalLeads,
            connection_requests_sent: 0,
            connection_requests_accepted: 0,
            linkedin_messages_sent: 0,
            linkedin_messages_replied: 0,
            voice_calls_made: 0,
            voice_calls_answered: 0,
            emails_sent: 0,
            emails_opened: 0,
            whatsapp_messages_sent: 0,
            whatsapp_messages_replied: 0,
            errors: 0
          },
          timeline: [], // TODO: Implement time series data
          step_analytics: stepAnalytics
        }
      });
    } catch (error) {
      logger.error('[Campaign Controller] Error getting campaign analytics', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign analytics',
        details: error.message
      });
    }
  }
}

module.exports = CampaignController;
