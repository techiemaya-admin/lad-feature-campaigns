/**
 * LinkedIn Checkpoint Service
 * Handles checkpoint solving and OTP verification
 */

const UnipileBaseService = require('./UnipileBaseService');
const axios = require('axios');

class LinkedInCheckpointService {
  constructor() {
    this.baseService = new UnipileBaseService();
  }

  /**
   * Solve checkpoint (Yes/No validation)
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} answer - YES or NO
   * @param {string} checkpointType - Checkpoint type
   * @returns {Object} Result
   */
  async solveCheckpoint(unipileAccountId, answer, checkpointType = 'IN_APP_VALIDATION') {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const response = await axios.post(
        `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
        {
          type: checkpointType,
          answer: answer
        },
        { headers, timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      console.error('[LinkedIn Checkpoint] Error solving checkpoint:', error);
      throw error;
    }
  }

  /**
   * Verify OTP for checkpoint
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} otp - OTP code
   * @returns {Object} Result
   */
  async verifyOTP(unipileAccountId, otp) {
    try {
      if (!this.baseService.isConfigured()) {
        throw new Error('Unipile is not configured');
      }

      const baseUrl = this.baseService.getBaseUrl();
      const headers = this.baseService.getAuthHeaders();

      const response = await axios.post(
        `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
        {
          type: 'OTP',
          code: otp
        },
        { headers, timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      console.error('[LinkedIn Checkpoint] Error verifying OTP:', error);
      throw error;
    }
  }
}

module.exports = new LinkedInCheckpointService();

