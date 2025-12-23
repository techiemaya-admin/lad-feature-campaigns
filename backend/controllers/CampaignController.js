/**
 * Campaign Controller
 * Main facade that combines all campaign controllers
 * This file maintains backward compatibility while delegating to split controllers
 */

// Import all controllers
const CampaignCRUDController = require('./CampaignCRUDController');
const CampaignActionsController = require('./CampaignActionsController');
const CampaignLeadsController = require('./CampaignLeadsController');
const CampaignStepsController = require('./CampaignStepsController');

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

  static async getCampaignActivities(req, res) {
    return CampaignLeadsController.getCampaignActivities(req, res);
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
}

module.exports = CampaignController;
