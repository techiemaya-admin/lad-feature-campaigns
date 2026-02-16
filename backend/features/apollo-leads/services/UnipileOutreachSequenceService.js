/**
 * Unipile Outreach Sequence Service
 * 
 * Implements LinkedIn outreach automation following Unipile best practices:
 * - Respects LinkedIn rate limits (80-100 requests/day, 200/week)
 * - Manages sending slots and scheduling
 * - Converts public IDs to private IDs before sending
 * - Handles bulk profile gathering and storage
 * - Implements human-like request spacing
 * 
 * References:
 * - Max 80-100 connection requests per day per account
 * - Max 200 per week
 * - Max 1,000 profiles per day to gather
 * - Recommend 30-50 invitations daily
 * - Spread across working hours with random intervals
 */

const axios = require('axios');
const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');
const { deductCredits } = require('../../../shared/middleware/credit_guard');
const { CREDIT_COSTS } = require('../constants/constants');

// LinkedIn Rate Limits (from Unipile documentation)
const LINKEDIN_LIMITS = {
  CONNECTION_REQUESTS_PER_DAY: 80, // Conservative: 80-100 per day
  CONNECTION_REQUESTS_PER_WEEK: 200,
  PROFILE_VISITS_PER_DAY_STANDARD: 80,
  PROFILE_VISITS_PER_DAY_SALES_NAV: 150,
  PROFILE_GATHERING_PER_DAY: 1000, // Max 1000 profiles to gather per day
  RECOMMENDED_DAILY_INVITES: 40, // Middle of 30-50 range
};

class UnipileOutreachSequenceService {
  constructor() {
    this.unipileDsn = process.env.UNIPILE_DSN;
    this.unipileToken = process.env.UNIPILE_TOKEN;
  }

  /**
   * Create an outreach sequence for a campaign
   * 
   * @param {Object} params
   * @param {string} params.campaignId - Campaign ID
   * @param {string} params.tenantId - Tenant ID
   * @param {Array} params.profileIds - List of LinkedIn profile IDs/URLs to contact
   * @param {string} params.accountId - Unipile LinkedIn account ID
   * @param {string} params.message - Connection request message template
   * @param {number} params.dailyLimit - Daily invitation limit (default: 40)
   * @param {string} params.startDate - Start date for sequence (default: today)
   * @returns {Promise<Object>} Sequence creation result
   */
  async createOutreachSequence(params) {
    try {
      const {
        campaignId,
        tenantId,
        profileIds,
        accountId,
        message,
        dailyLimit = LINKEDIN_LIMITS.RECOMMENDED_DAILY_INVITES,
        startDate = new Date().toISOString().split('T')[0]
      } = params;

      if (!campaignId || !tenantId) {
        throw new Error('campaignId and tenantId are required');
      }

      if (!Array.isArray(profileIds) || profileIds.length === 0) {
        throw new Error('profileIds array is required and must not be empty');
      }

      if (!accountId) {
        throw new Error('accountId (Unipile LinkedIn account ID) is required');
      }

      // Validate daily limit
      const validDailyLimit = Math.min(
        dailyLimit,
        LINKEDIN_LIMITS.CONNECTION_REQUESTS_PER_DAY
      );

      logger.info('[Outreach Sequence] Creating sequence', {
        campaignId,
        totalProfiles: profileIds.length,
        dailyLimit: validDailyLimit,
        startDate,
        tenantId
      });

      // Calculate sequence duration
      const totalDays = Math.ceil(profileIds.length / validDailyLimit);
      const weeklyRequests = Math.min(validDailyLimit * 5, LINKEDIN_LIMITS.CONNECTION_REQUESTS_PER_WEEK);
      const estimatedWeeks = Math.ceil(profileIds.length / weeklyRequests);

      logger.info('[Outreach Sequence] Duration calculation', {
        totalProfiles: profileIds.length,
        dailyLimit: validDailyLimit,
        totalDays,
        estimatedWeeks
      });

      // Store sequence in database
      const sequenceId = await this.saveSequence({
        campaignId,
        tenantId,
        accountId,
        totalProfiles: profileIds.length,
        dailyLimit: validDailyLimit,
        estimatedDays: totalDays,
        estimatedWeeks,
        startDate,
        message
      });

      // Create and store sending slots
      const sendingSlots = this.generateSendingSlots(
        profileIds,
        validDailyLimit,
        new Date(startDate)
      );

      await this.saveSendingSlots(sequenceId, tenantId, sendingSlots);

      return {
        success: true,
        sequenceId,
        totalProfiles: profileIds.length,
        dailyLimit: validDailyLimit,
        estimatedDays: totalDays,
        estimatedWeeks,
        startDate,
        slots: sendingSlots.length
      };
    } catch (error) {
      logger.error('[Outreach Sequence] Creation failed', {
        error: error.message,
        params,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate sending slots with human-like timing
   * Spreads invitations across working hours with random intervals
   * 
   * @private
   */
  generateSendingSlots(profileIds, dailyLimit, startDate) {
    const slots = [];
    let currentDate = new Date(startDate);
    let profileIndex = 0;

    // Working hours: 9 AM to 6 PM (9-18)
    const WORKING_HOURS_START = 9;
    const WORKING_HOURS_END = 18;
    const WORKING_HOURS_DURATION = WORKING_HOURS_END - WORKING_HOURS_START; // 9 hours

    while (profileIndex < profileIds.length) {
      // Skip weekends
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // Generate random times throughout the day
      const slotsForDay = this.generateDaySlots(
        profileIds,
        profileIndex,
        Math.min(dailyLimit, profileIds.length - profileIndex),
        currentDate,
        WORKING_HOURS_START,
        WORKING_HOURS_END
      );

      slots.push(...slotsForDay);
      profileIndex += slotsForDay.length;

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }

  /**
   * Generate sending slots for a single day with random intervals
   * 
   * @private
   */
  generateDaySlots(profileIds, startIndex, count, date, startHour, endHour) {
    const slots = [];
    const daySlots = [];

    // Generate random times within working hours
    const timeIntervals = [];
    const minutesAvailable = (endHour - startHour) * 60;
    const intervalMinutes = Math.floor(minutesAvailable / (count + 1));

    for (let i = 1; i <= count; i++) {
      // Add some randomness (±15 minutes)
      const randomOffset = Math.floor(Math.random() * 30) - 15;
      const totalMinutes = intervalMinutes * i + randomOffset;
      const hour = startHour + Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;

      timeIntervals.push({
        hour: Math.min(hour, endHour - 1),
        minute: Math.max(0, Math.min(minute, 59))
      });
    }

    // Create slots
    for (let i = 0; i < count; i++) {
      const profileId = profileIds[startIndex + i];
      const time = timeIntervals[i];
      const slotDate = new Date(date);
      slotDate.setHours(time.hour, time.minute, 0, 0);

      daySlots.push({
        profileId,
        scheduledTime: slotDate.toISOString(),
        day: date.toISOString().split('T')[0],
        hour: time.hour,
        minute: time.minute,
        status: 'pending' // pending, sent, failed
      });
    }

    return daySlots;
  }

  /**
   * Get pending sending slots for today
   */
  async getPendingSlotsForToday(accountId, tenantId) {
    try {
      const schema = getSchema(null);
      const today = new Date().toISOString().split('T')[0];

      const result = await pool.query(
        `SELECT 
          os.id,
          os.sequence_id,
          os.profile_id,
          os.scheduled_time,
          os.status,
          seq.campaign_id,
          seq.message
        FROM ${schema}.outreach_sending_slots os
        JOIN ${schema}.outreach_sequences seq ON os.sequence_id = seq.id
        WHERE seq.account_id = $1 
          AND seq.tenant_id = $2
          AND DATE(os.scheduled_time AT TIME ZONE 'UTC') = $3
          AND os.status = 'pending'
        ORDER BY os.scheduled_time ASC`,
        [accountId, tenantId, today]
      );

      return {
        success: true,
        slots: result.rows,
        count: result.rows.length
      };
    } catch (error) {
      logger.error('[Outreach Sequence] Get pending slots failed', {
        error: error.message,
        accountId,
        tenantId
      });

      return {
        success: false,
        error: error.message,
        slots: []
      };
    }
  }

  /**
   * Send a connection request via Unipile
   * 
   * Retrieves user's profile to convert public ID to private ID,
   * checks relationship status, and sends appropriate message type
   */
  async sendConnectionRequest(params) {
    try {
      const {
        slotId,
        profileId,
        accountId,
        tenantId,
        message,
        sequenceId
      } = params;

      if (!profileId || !accountId) {
        throw new Error('profileId and accountId are required');
      }

      logger.info('[Outreach Sequence] Sending connection request', {
        slotId,
        profileId,
        accountId
      });

      const baseUrl = this.getBaseUrl();
      const headers = this.getAuthHeaders();

      // STEP 1: Retrieve profile to get private ID and relationship status
      const profileResponse = await axios.get(
        `${baseUrl}/linkedin/profile`,
        {
          headers,
          params: {
            account_id: accountId,
            profile_url: profileId
          },
          timeout: 30000
        }
      );

      const profile = profileResponse.data?.data || profileResponse.data;

      if (!profile) {
        throw new Error('Profile not found');
      }

      const privateId = profile.id || profile.private_id;
      const relationshipStatus = profile.relationship || 'not_connected'; // UNKNOWN, CONNECTED, NOT_CONNECTED, PENDING_OUTGOING, PENDING_INCOMING

      logger.debug('[Outreach Sequence] Profile retrieved', {
        profileId,
        privateId,
        relationshipStatus
      });

      // STEP 2: Determine action based on relationship status
      let result = {};

      if (relationshipStatus === 'CONNECTED' || relationshipStatus === 'PENDING_OUTGOING') {
        // Already connected or pending - send message instead
        result = await this.sendMessage(
          accountId,
          privateId,
          message,
          headers,
          baseUrl,
          tenantId
        );
      } else if (relationshipStatus === 'PENDING_INCOMING') {
        // Has pending incoming request - accept and send message
        result = await this.acceptAndMessage(
          accountId,
          privateId,
          message,
          headers,
          baseUrl,
          tenantId
        );
      } else {
        // Not connected - send connection request
        result = await this.sendConnectionInvitation(
          accountId,
          privateId,
          message,
          headers,
          baseUrl,
          tenantId
        );
      }

      // STEP 3: Update slot status
      if (slotId && tenantId) {
        await this.updateSlotStatus(slotId, tenantId, 'sent', result);
      }

      return {
        success: true,
        profileId,
        privateId,
        relationshipStatus,
        actionTaken: result.actionTaken,
        result
      };
    } catch (error) {
      logger.error('[Outreach Sequence] Send connection request failed', {
        error: error.message,
        params,
        stack: error.stack
      });

      // Update slot status as failed
      if (params.slotId && params.tenantId) {
        await this.updateSlotStatus(params.slotId, params.tenantId, 'failed', {
          error: error.message
        });
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send connection invitation via Unipile
   * 
   * @private
   */
  async sendConnectionInvitation(accountId, privateId, message, headers, baseUrl, tenantId = null) {
    const response = await axios.post(
      `${baseUrl}/linkedin/invite`,
      {
        account_id: accountId,
        profile_id: privateId,
        message: message
      },
      { headers, timeout: 30000 }
    );

    // Deduct credits for successful connection request
    if (tenantId) {
      try {
        let totalCredits = CREDIT_COSTS.LINKEDIN_CONNECTION || 1;
        let usageType = 'linkedin_connection';
        
        if (message) {
          totalCredits += CREDIT_COSTS.TEMPLATE_MESSAGE || 5;
          usageType = 'linkedin_connection_with_message';
        }
        
        const mockReq = { tenant: { id: tenantId } };
        await deductCredits(tenantId, 'apollo-leads', usageType, totalCredits, mockReq);
        logger.info('[Outreach Sequence] Credits deducted for connection', { 
          tenantId, 
          credits: totalCredits,
          hasMessage: !!message 
        });
      } catch (creditError) {
        logger.error('[Outreach Sequence] Failed to deduct credits', { 
          error: creditError.message, 
          tenantId 
        });
      }
    }

    return {
      actionTaken: 'invitation_sent',
      response: response.data,
      credits_used: (CREDIT_COSTS.LINKEDIN_CONNECTION || 1) + (message ? (CREDIT_COSTS.TEMPLATE_MESSAGE || 5) : 0)
    };
  }

  /**
   * Send direct message via Unipile
   * 
   * @private
   */
  async sendMessage(accountId, privateId, message, headers, baseUrl, tenantId = null) {
    const response = await axios.post(
      `${baseUrl}/linkedin/message`,
      {
        account_id: accountId,
        conversation_id: privateId,
        content: message
      },
      { headers, timeout: 30000 }
    );

    // Deduct credits for template message
    if (tenantId && message) {
      try {
        const credits = CREDIT_COSTS.TEMPLATE_MESSAGE || 5;
        const mockReq = { tenant: { id: tenantId } };
        await deductCredits(tenantId, 'apollo-leads', 'template_message', credits, mockReq);
        logger.info('[Outreach Sequence] Credits deducted for message', { 
          tenantId, 
          credits 
        });
      } catch (creditError) {
        logger.error('[Outreach Sequence] Failed to deduct credits for message', { 
          error: creditError.message, 
          tenantId 
        });
      }
    }

    return {
      actionTaken: 'message_sent',
      response: response.data,
      credits_used: message ? (CREDIT_COSTS.TEMPLATE_MESSAGE || 5) : 0
    };
  }

  /**
   * Accept pending request and send message
   * 
   * @private
   */
  async acceptAndMessage(accountId, privateId, message, headers, baseUrl, tenantId = null) {
    // Accept incoming connection
    await axios.post(
      `${baseUrl}/linkedin/accept-invitation`,
      {
        account_id: accountId,
        profile_id: privateId
      },
      { headers, timeout: 30000 }
    );

    // Then send message
    const messageResponse = await axios.post(
      `${baseUrl}/linkedin/message`,
      {
        account_id: accountId,
        conversation_id: privateId,
        content: message
      },
      { headers, timeout: 30000 }
    );

    // Deduct credits for template message (accepting is free)
    if (tenantId && message) {
      try {
        const credits = CREDIT_COSTS.TEMPLATE_MESSAGE || 5;
        const mockReq = { tenant: { id: tenantId } };
        await deductCredits(tenantId, 'apollo-leads', 'template_message', credits, mockReq);
        logger.info('[Outreach Sequence] Credits deducted for accept+message', { 
          tenantId, 
          credits 
        });
      } catch (creditError) {
        logger.error('[Outreach Sequence] Failed to deduct credits', { 
          error: creditError.message, 
          tenantId 
        });
      }
    }

    return {
      actionTaken: 'accepted_and_messaged',
      response: messageResponse.data,
      credits_used: message ? (CREDIT_COSTS.TEMPLATE_MESSAGE || 5) : 0
    };
  }

  /**
   * Process all pending slots for today (cron job)
   */
  async processPendingSlots(accountId, tenantId) {
    try {
      const pendingSlots = await this.getPendingSlotsForToday(accountId, tenantId);

      if (!pendingSlots.success || pendingSlots.slots.length === 0) {
        logger.info('[Outreach Sequence] No pending slots for today', {
          accountId,
          tenantId
        });
        return { processed: 0 };
      }

      let processed = 0;
      let failed = 0;

      for (const slot of pendingSlots.slots) {
        // Check if it's time to send (current time >= scheduled time)
        const now = new Date();
        const scheduledTime = new Date(slot.scheduled_time);

        if (now >= scheduledTime) {
          const result = await this.sendConnectionRequest({
            slotId: slot.id,
            profileId: slot.profile_id,
            accountId,
            tenantId,
            message: slot.message,
            sequenceId: slot.sequence_id
          });

          if (result.success) {
            processed++;
          } else {
            failed++;
          }

          // Add random delay to mimic human behavior (2-5 seconds)
          const delay = Math.floor(Math.random() * 3000) + 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      logger.info('[Outreach Sequence] Processed pending slots', {
        accountId,
        tenantId,
        processed,
        failed
      });

      return { processed, failed };
    } catch (error) {
      logger.error('[Outreach Sequence] Process pending slots failed', {
        error: error.message,
        accountId,
        tenantId
      });

      return { error: error.message, processed: 0 };
    }
  }

  /**
   * Get sequence status
   */
  async getSequenceStatus(sequenceId, tenantId) {
    try {
      const schema = getSchema(null);

      const sequence = await pool.query(
        `SELECT * FROM ${schema}.outreach_sequences WHERE id = $1 AND tenant_id = $2`,
        [sequenceId, tenantId]
      );

      if (sequence.rows.length === 0) {
        return { success: false, error: 'Sequence not found' };
      }

      const slots = await pool.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM ${schema}.outreach_sending_slots
        WHERE sequence_id = $1`,
        [sequenceId]
      );

      const stats = slots.rows[0];

      return {
        success: true,
        sequence: sequence.rows[0],
        stats: {
          total: parseInt(stats.total),
          sent: parseInt(stats.sent) || 0,
          failed: parseInt(stats.failed) || 0,
          pending: parseInt(stats.pending) || 0,
          successRate: stats.total > 0 ? ((parseInt(stats.sent) / parseInt(stats.total)) * 100).toFixed(1) : 0
        }
      };
    } catch (error) {
      logger.error('[Outreach Sequence] Get status failed', {
        error: error.message,
        sequenceId
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: Save sequence to database
   * 
   * @private
   */
  async saveSequence(params) {
    const schema = getSchema(null);
    const {
      campaignId,
      tenantId,
      accountId,
      totalProfiles,
      dailyLimit,
      estimatedDays,
      estimatedWeeks,
      startDate,
      message
    } = params;

    const result = await pool.query(
      `INSERT INTO ${schema}.outreach_sequences 
        (campaign_id, tenant_id, account_id, total_profiles, daily_limit, 
         estimated_days, estimated_weeks, start_date, message, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW())
       RETURNING id`,
      [campaignId, tenantId, accountId, totalProfiles, dailyLimit, 
       estimatedDays, estimatedWeeks, startDate, message]
    );

    return result.rows[0].id;
  }

  /**
   * Helper: Save sending slots to database
   * 
   * @private
   */
  async saveSendingSlots(sequenceId, tenantId, slots) {
    const schema = getSchema(null);

    const values = slots.map(slot => [
      sequenceId,
      tenantId,
      slot.profileId,
      slot.scheduledTime,
      'pending',
      slot.day
    ]);

    const placeholders = values
      .map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`)
      .join(',');

    const flatValues = values.flat();

    await pool.query(
      `INSERT INTO ${schema}.outreach_sending_slots 
        (sequence_id, tenant_id, profile_id, scheduled_time, status, day)
       VALUES ${placeholders}`,
      flatValues
    );
  }

  /**
   * Helper: Update slot status
   * 
   * @private
   */
  async updateSlotStatus(slotId, tenantId, status, metadata = {}) {
    const schema = getSchema(null);

    await pool.query(
      `UPDATE ${schema}.outreach_sending_slots 
       SET status = $1, 
           metadata = $3,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $4`,
      [status, slotId, JSON.stringify(metadata), tenantId]
    );
  }

  /**
   * Get base URL for Unipile API
   * According to Unipile docs: https://{YOUR_DSN}/api/v1/...
   * DSN includes hostname and port (e.g., api8.unipile.com:13811)
   */
  getBaseUrl() {
    if (!this.unipileDsn) {
      throw new Error('UNIPILE_DSN not configured');
    }

    let dsn = this.unipileDsn.trim();
    
    // Add https:// if not present
    if (!dsn.startsWith('http://') && !dsn.startsWith('https://')) {
      dsn = `https://${dsn}`;
    }
    
    // Remove trailing slashes
    dsn = dsn.replace(/\/+$/, '');
    
    // Add /api/v1 path
    if (!dsn.includes('/api/v1')) {
      dsn = `${dsn}/api/v1`;
    }
    
    return dsn;
  }

  /**
   * Get authentication headers
   * According to Unipile docs: X-API-KEY header with Access Token
   */
  getAuthHeaders() {
    if (!this.unipileToken) {
      throw new Error('UNIPILE_TOKEN not configured');
    }
    return {
      'X-API-KEY': this.unipileToken,
      'Content-Type': 'application/json'
    };
  }
}

module.exports = new UnipileOutreachSequenceService();
