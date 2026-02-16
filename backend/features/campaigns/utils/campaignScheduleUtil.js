/**
 * Campaign Schedule Utility
 * Pure utility functions for calculating campaign schedule dates
 * LAD Architecture: Utilities - No database access, no business logic
 */

const logger = require('../../../core/utils/logger');

class CampaignScheduleUtil {
  /**
   * Parse working days string to array of day numbers (0=Sunday, 6=Saturday)
   * @param {string} workingDaysStr - e.g., "Monday-Friday (Weekdays only)"
   * @returns {number[]} Array of day numbers
   */
  static parseWorkingDays(workingDaysStr) {
    if (!workingDaysStr) {
      // Default to weekdays
      return [1, 2, 3, 4, 5]; // Monday-Friday
    }

    const str = workingDaysStr.toLowerCase();

    // Check for weekdays pattern
    if (str.includes('weekday') || str.includes('monday-friday') || str.includes('mon-fri')) {
      return [1, 2, 3, 4, 5]; // Monday-Friday
    }

    // Check for all days / 7 days
    if (str.includes('all day') || str.includes('every day') || str === '7 days') {
      return [0, 1, 2, 3, 4, 5, 6]; // All days
    }

    // Check for weekend
    if (str.includes('weekend') || str.includes('saturday-sunday') || str.includes('sat-sun')) {
      return [0, 6]; // Saturday-Sunday
    }

    // Default to weekdays if unable to parse
    logger.warn('[CampaignScheduleUtil] Unable to parse working_days, defaulting to weekdays', {
      workingDaysStr
    });
    return [1, 2, 3, 4, 5];
  }

  /**
   * Calculate schedule dates for campaign execution
   * @param {Date} startTimestamp - Campaign start timestamp from message_data
   * @param {number} campaignDays - Total campaign days from message_data
   * @param {number[]} workingDays - Array of working day numbers (0=Sunday, 6=Saturday)
   * @returns {Date[]} Array of schedule dates
   */
  static calculateScheduleDates(startTimestamp, campaignDays, workingDays) {
    const scheduleDates = [];
    const startDate = new Date(startTimestamp);
    
    // Start from the next day after timestamp (as per requirement)
    let currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate.setHours(startDate.getHours());
    currentDate.setMinutes(startDate.getMinutes());
    currentDate.setSeconds(startDate.getSeconds());

    let daysAdded = 0;
    const maxIterations = campaignDays * 3; // Safety limit
    let iterations = 0;

    while (daysAdded < campaignDays && iterations < maxIterations) {
      const dayOfWeek = currentDate.getDay();

      if (workingDays.includes(dayOfWeek)) {
        scheduleDates.push(new Date(currentDate));
        daysAdded++;
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      iterations++;
    }

    return scheduleDates;
  }

  /**
   * Extract schedule parameters from message_data
   * @param {Object} messageData - The message_data JSONB from ai_messages (normalized)
   * @returns {Object} Extracted parameters: { timestamp, campaignDays, workingDaysStr, workingDays }
   */
  static extractScheduleParams(messageData) {
    if (!messageData) {
      throw new Error('message_data is required for campaign scheduling');
    }

    logger.info('[CampaignScheduleUtil] Extracting schedule params - RAW INPUT', {
      messageDataKeys: Object.keys(messageData),
      hasCollectedAnswers: !!messageData.collectedAnswers,
      topLevelTimestamp: messageData.timestamp,
      topLevelCampaignDays: messageData.campaign_days,
      topLevelWorkingDays: messageData.working_days,
      nestedCampaignDays: messageData.collectedAnswers?.campaign_days,
      nestedWorkingDays: messageData.collectedAnswers?.working_days,
      fullMessageData: JSON.stringify(messageData, null, 2)
    });

    // Handle both normalized (flat) and legacy (nested) structures
    const timestamp = messageData.timestamp;
    const campaignDaysRaw = messageData.campaign_days || messageData.collectedAnswers?.campaign_days || '7';
    const workingDaysStr = messageData.working_days || messageData.collectedAnswers?.working_days || 'Monday-Friday';
    
    // Parse campaign_days - handle both string and number, and extract number from "7 days (1 week)"
    let campaignDays;
    if (typeof campaignDaysRaw === 'number') {
      campaignDays = campaignDaysRaw;
    } else {
      // Extract first number from string like "7 days (1 week)" or "7"
      const match = String(campaignDaysRaw).match(/(\d+)/);
      campaignDays = match ? parseInt(match[1]) : 7;
    }
    
    const workingDays = this.parseWorkingDays(workingDaysStr);

    if (!timestamp) {
      throw new Error('timestamp is required in message_data for campaign scheduling');
    }

    logger.info('[CampaignScheduleUtil] Extracted schedule params - RESULT', {
      timestamp,
      campaignDays,
      campaignDaysRaw,
      workingDaysStr,
      workingDaysArray: workingDays
    });

    return {
      timestamp: new Date(timestamp),
      campaignDays,
      workingDaysStr,
      workingDays
    };
  }

  /**
   * Calculate start and end dates for campaign
   * @param {Object} messageData - The message_data JSONB from ai_messages
   * @returns {Object} { startDate, endDate, scheduleDates, workingDays, workingDaysStr }
   */
  static calculateCampaignDates(messageData) {
    const { timestamp, campaignDays, workingDaysStr, workingDays } = 
      this.extractScheduleParams(messageData);

    const scheduleDates = this.calculateScheduleDates(timestamp, campaignDays, workingDays);

    if (scheduleDates.length === 0) {
      throw new Error('No valid schedule dates calculated for campaign');
    }

    const startDate = scheduleDates[0];
    const endDate = scheduleDates[scheduleDates.length - 1];

    return {
      startDate,
      endDate,
      scheduleDates,
      workingDays,
      workingDaysStr
    };
  }
}

module.exports = CampaignScheduleUtil;
