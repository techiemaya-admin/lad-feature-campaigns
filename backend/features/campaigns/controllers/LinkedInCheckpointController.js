/**
 * LinkedIn Checkpoint Controller
 * Handles checkpoint operations (OTP, Yes/No validation)
 * Extracted from LinkedInAuthController to comply with 499-line limit
 */
const linkedInService = require('../services/LinkedInIntegrationService');
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
      // Get checkpoint type from database (default: IN_APP_VALIDATION)
      let checkpointType = 'IN_APP_VALIDATION';
      try {
        const { pool } = require('../../../shared/database/connection');
        const tenantId = req.user.tenantId || userId;
        const schema = process.env.DB_SCHEMA || 'lad_dev';
        const checkpointQuery = `
          SELECT metadata
          FROM ${schema}.linkedin_accounts
          WHERE unipile_account_id = $1 AND tenant_id = $2 AND is_active = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const checkpointResult = await pool.query(checkpointQuery, [unipileAccountId, tenantId]);
        if (checkpointResult.rows.length > 0) {
          const metadata = typeof checkpointResult.rows[0].metadata === 'string'
            ? JSON.parse(checkpointResult.rows[0].metadata)
            : (checkpointResult.rows[0].metadata || {});
          checkpointType = metadata.checkpoint?.type || 'IN_APP_VALIDATION';
        }
      } catch (dbError) {
      }
      const result = await linkedInService.solveCheckpoint(unipileAccountId, answer, checkpointType);
      res.json({
        success: true,
        message: 'Checkpoint solved successfully',
        result
      });
    } catch (error) {
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
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get checkpoint status'
      });
    }
  }
}
module.exports = LinkedInCheckpointController;