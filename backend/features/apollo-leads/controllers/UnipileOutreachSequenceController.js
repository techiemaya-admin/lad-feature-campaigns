/**
 * Unipile Outreach Sequence Controller
 * 
 * Handles API endpoints for creating and managing LinkedIn outreach sequences
 */

const UnipileOutreachSequenceService = require('../services/UnipileOutreachSequenceService');
const logger = require('../../../core/utils/logger');

class UnipileOutreachSequenceController {
  /**
   * Create an outreach sequence
   * POST /api/apollo-leads/unipile/outreach/create
   */
  static async createSequence(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      
      const {
        campaignId,
        profileIds,
        accountId,
        message,
        dailyLimit = 40,
        startDate
      } = req.body;

      if (!campaignId || !profileIds || !accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: campaignId, profileIds, accountId'
        });
      }

      if (!Array.isArray(profileIds) || profileIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'profileIds must be a non-empty array'
        });
      }

      logger.info('[Outreach Controller] Creating sequence', {
        tenantId,
        campaignId,
        profileCount: profileIds.length,
        accountId
      });

      const result = await UnipileOutreachSequenceService.createOutreachSequence({
        campaignId,
        tenantId,
        profileIds,
        accountId,
        message,
        dailyLimit,
        startDate
      });

      res.json(result);
    } catch (error) {
      logger.error('[Outreach Controller] Create sequence error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get pending slots for today
   * GET /api/apollo-leads/unipile/outreach/pending
   */
  static async getPendingSlots(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      const { accountId } = req.query;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required query parameter: accountId'
        });
      }

      logger.info('[Outreach Controller] Getting pending slots', {
        tenantId,
        accountId
      });

      const result = await UnipileOutreachSequenceService.getPendingSlotsForToday(
        accountId,
        tenantId
      );

      res.json({
        success: result.success,
        slots: result.slots,
        count: result.count,
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Outreach Controller] Get pending slots error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Send a connection request manually
   * POST /api/apollo-leads/unipile/outreach/send
   */
  static async sendRequest(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      
      const {
        slotId,
        profileId,
        accountId,
        message,
        sequenceId
      } = req.body;

      if (!profileId || !accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: profileId, accountId'
        });
      }

      logger.info('[Outreach Controller] Sending request', {
        tenantId,
        slotId,
        profileId,
        accountId
      });

      const result = await UnipileOutreachSequenceService.sendConnectionRequest({
        slotId,
        profileId,
        accountId,
        tenantId,
        message,
        sequenceId
      });

      res.json(result);
    } catch (error) {
      logger.error('[Outreach Controller] Send request error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Process all pending slots (cron trigger)
   * POST /api/apollo-leads/unipile/outreach/process
   */
  static async processPending(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      const { accountId } = req.body;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: accountId'
        });
      }

      logger.info('[Outreach Controller] Processing pending slots', {
        tenantId,
        accountId
      });

      const result = await UnipileOutreachSequenceService.processPendingSlots(
        accountId,
        tenantId
      );

      res.json({
        success: !result.error,
        processed: result.processed,
        failed: result.failed,
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Outreach Controller] Process pending error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get sequence status
   * GET /api/apollo-leads/unipile/outreach/:sequenceId/status
   */
  static async getStatus(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      const { sequenceId } = req.params;

      if (!sequenceId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameter: sequenceId'
        });
      }

      logger.info('[Outreach Controller] Getting sequence status', {
        tenantId,
        sequenceId
      });

      const result = await UnipileOutreachSequenceService.getSequenceStatus(
        sequenceId,
        tenantId
      );

      res.json(result);
    } catch (error) {
      logger.error('[Outreach Controller] Get status error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = UnipileOutreachSequenceController;
