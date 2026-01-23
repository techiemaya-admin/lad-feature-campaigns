/**
 * Campaign Steps Controller
 * Handles step management for campaigns
 */
const CampaignStepModel = require('../models/CampaignStepModel');
class CampaignStepsController {
  /**
   * GET /api/campaigns/:id/steps
   * Get steps for a campaign
   */
  static async getCampaignSteps(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const steps = await CampaignStepModel.getStepsByCampaignId(id, tenantId);
      res.json({
        success: true,
        data: steps
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get campaign steps',
        message: error.message
      });
    }
  }
  /**
   * POST /api/campaigns/:id/steps
   * Add/update steps for a campaign
   */
  static async updateCampaignSteps(req, res) {
    try {
      const tenantId = req.user.tenantId;
      const { id } = req.params;
      const { steps } = req.body;
      if (!steps || !Array.isArray(steps)) {
        return res.status(400).json({
          success: false,
          error: 'Steps array is required'
        });
      }
      // Delete existing steps
      await CampaignStepModel.deleteByCampaignId(id, tenantId);
      // Create new steps
      const createdSteps = await CampaignStepModel.bulkCreate(id, tenantId, steps);
      res.json({
        success: true,
        data: createdSteps
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update campaign steps',
        message: error.message
      });
    }
  }
}
module.exports = CampaignStepsController;