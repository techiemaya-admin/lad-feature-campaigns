/**
 * LinkedIn Checkpoint Controller
 * Handles checkpoint operations (OTP, Yes/No validation)
 * Extracted from LinkedInAuthController to comply with 499-line limit
 */

const linkedInService = require('../services/LinkedInIntegrationService');
const linkedInAccountService = require('../services/LinkedInAccountService');
const { getSchema } = require('../utils/schema');
const logger = require('../utils/logger');

class LinkedInCheckpointController {
  /**
   * Solve checkpoint (Yes/No validation)
   * POST /api/campaigns/linkedin/solve-checkpoint
   */
  static async solveCheckpoint(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { answer, account_id, email } = req.body;
      
      if (!answer || (answer !== 'YES' && answer !== 'NO')) {
        return res.status(400).json({
          success: false,
          error: 'Answer is required and must be YES or NO'
        });
      }

      // Get account ID from request or database
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        if (accounts.length > 0) {
          unipileAccountId = accounts[0].unipile_account_id;
        }
      }

      if (!unipileAccountId) {
        return res.status(400).json({
          success: false,
          error: 'Account ID is required'
        });
      }

      // Get checkpoint type from database via service layer (default: IN_APP_VALIDATION)
      const tenantId = req.user.tenantId || userId;
      const schema = getSchema(req);
      const checkpointType = await linkedInAccountService.getCheckpointType(unipileAccountId, tenantId, schema);

      const result = await linkedInService.solveCheckpoint(unipileAccountId, answer, checkpointType);
      
      res.json({
        success: true,
        message: 'Checkpoint solved successfully',
        result
      });
    } catch (error) {
      logger.error('[LinkedIn Checkpoint] Error solving checkpoint', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to solve checkpoint'
      });
    }
  }

  /**
   * Verify OTP
   * POST /api/campaigns/linkedin/verify-otp
   */
  static async verifyOTP(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { otp, account_id, email } = req.body;
      
      if (!otp) {
        return res.status(400).json({
          success: false,
          error: 'OTP is required'
        });
      }

      // Get account ID from request or database
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        if (accounts.length > 0) {
          unipileAccountId = accounts[0].unipile_account_id;
        }
      }

      if (!unipileAccountId) {
        return res.status(400).json({
          success: false,
          error: 'Account ID is required'
        });
      }

      const result = await linkedInService.verifyOTP(unipileAccountId, otp);
      
      res.json({
        success: true,
        message: 'OTP verified successfully',
        result
      });
    } catch (error) {
      logger.error('[LinkedIn Checkpoint] Error verifying OTP', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify OTP'
      });
    }
  }

  /**
   * Get checkpoint status (for polling Yes/No checkpoints)
   * GET /api/campaigns/linkedin/checkpoint-status
   */
  static async getCheckpointStatus(req, res) {
    try {
      const userId = req.user.userId || req.user.user_id;
      const { account_id } = req.query;
      
      // Get account ID
      let unipileAccountId = account_id;
      if (!unipileAccountId) {
        const accounts = await linkedInService.getUserLinkedInAccounts(userId);
        if (accounts.length > 0) {
          unipileAccountId = accounts[0].unipile_account_id;
        }
      }

      if (!unipileAccountId) {
        return res.status(400).json({
          success: false,
          error: 'Account ID is required'
        });
      }

      // Get account details from Unipile to check checkpoint status
      const accountDetails = await linkedInService.getAccountDetails(unipileAccountId);
      
      // Check if account is still in checkpoint state
      const isCheckpoint = accountDetails?.checkpoint && accountDetails.checkpoint.required;
      const isConnected = accountDetails?.state === 'connected' || accountDetails?.status === 'connected';
      
      res.json({
        success: true,
        connected: isConnected && !isCheckpoint,
        status: isConnected ? 'connected' : (isCheckpoint ? 'checkpoint' : 'disconnected'),
        checkpoint: accountDetails?.checkpoint || null
      });
    } catch (error) {
      logger.error('[LinkedIn Checkpoint] Error getting checkpoint status', { error: error.message, stack: error.stack });
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get checkpoint status'
      });
    }
  }
}

module.exports = LinkedInCheckpointController;

