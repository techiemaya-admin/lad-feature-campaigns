/**
 * LinkedIn Checkpoint Service
 * Handles checkpoint detection and processing for LinkedIn OAuth
 */
const { extractCheckpointInfo } = require('./LinkedInProfileHelper');
const axios = require('axios');
const logger = require('../../../core/utils/logger');
const UnipileBaseService = require('./UnipileBaseService');

/**
 * Handle checkpoint response from Unipile SDK
 */
async function handleCheckpointResponse(account, unipile, email = null) {
  if (!account || account.object !== 'Checkpoint' || !account.checkpoint) {
    return null;
  }
  // Extract account ID from checkpoint response
  const accountId = account.account_id || account.id || account._id;
  if (!accountId) {
    throw new Error('LinkedIn requires verification, but no account ID was returned.');
  }
  // Extract checkpoint information
  const checkpointInfo = await extractCheckpointInfo(account, unipile, accountId);
  if (!checkpointInfo) {
    throw new Error('Failed to extract checkpoint information');
  }
  // Add email and profileName if provided
  if (email) {
    checkpointInfo.email = email;
    checkpointInfo.profileName = email.split('@')[0];
  } else if (account.profile_name) {
    checkpointInfo.profileName = account.profile_name;
    checkpointInfo.email = account.email || null;
  }
  return checkpointInfo;
}

/**
 * Solve checkpoint (Yes/No or other types)
 * @param {string} unipileAccountId - Unipile account ID
 * @param {string} answer - Answer to checkpoint
 * @param {string} checkpointType - Type of checkpoint
 * @returns {Object} Result
 */
async function solveCheckpoint(unipileAccountId, answer, checkpointType = 'IN_APP_VALIDATION') {
  try {
    const baseService = new UnipileBaseService();
    
    if (!baseService.isConfigured()) {
      throw new Error('Unipile is not configured');
    }

    const baseUrl = baseService.getBaseUrl();
    let sdkBaseUrl = baseUrl;
    
    // Clean up SDK base URL
    if (sdkBaseUrl.endsWith('/api/v1')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
    } else if (sdkBaseUrl.endsWith('/api/v1/')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1\/$/, '');
    }

    const token = (baseService.dsn && baseService.token)
      ? baseService.token.trim()
      : (process.env.UNIPILE_TOKEN || '').trim();

    if (!token) {
      throw new Error('UNIPILE_TOKEN is not configured');
    }

    logger.info('[LinkedInCheckpointService] Solving checkpoint', {
      unipileAccountId,
      checkpointType
    });

    // Try SDK first
    const { UnipileClient } = require('unipile-node-sdk');
    const unipile = new UnipileClient(sdkBaseUrl, token);
    let solveResponse;

    if (unipile.account && typeof unipile.account.solveCheckpoint === 'function') {
      solveResponse = await unipile.account.solveCheckpoint({
        account_id: unipileAccountId,
        type: checkpointType,
        answer: answer
      });
    } else {
      // Fallback to HTTP
      const headers = baseService.getAuthHeaders();
      const response = await axios.post(
        `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
        {
          type: checkpointType,
          answer: answer
        },
        { headers, timeout: 30000 }
      );
      solveResponse = response.data;
    }

    logger.info('[LinkedInCheckpointService] Checkpoint solved successfully', { unipileAccountId });
    return solveResponse;
  } catch (error) {
    logger.error('[LinkedInCheckpointService] Error solving checkpoint', {
      unipileAccountId,
      checkpointType,
      error: error.message
    });
    throw error;
  }
}

/**
 * Verify OTP for LinkedIn checkpoint
 * @param {string} unipileAccountId - Unipile account ID
 * @param {string} otp - OTP code
 * @returns {Object} Verification result
 */
async function verifyOTP(unipileAccountId, otp) {
  try {
    const baseService = new UnipileBaseService();
    
    if (!baseService.isConfigured()) {
      throw new Error('Unipile is not configured');
    }

    const baseUrl = baseService.getBaseUrl();
    let sdkBaseUrl = baseUrl;
    
    // Clean up SDK base URL
    if (sdkBaseUrl.endsWith('/api/v1')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
    } else if (sdkBaseUrl.endsWith('/api/v1/')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1\/$/, '');
    }

    const token = (baseService.dsn && baseService.token)
      ? baseService.token.trim()
      : (process.env.UNIPILE_TOKEN || '').trim();

    if (!token) {
      throw new Error('UNIPILE_TOKEN is not configured');
    }

    logger.info('[LinkedInCheckpointService] Verifying OTP', { unipileAccountId });

    // Try SDK first
    const { UnipileClient } = require('unipile-node-sdk');
    const unipile = new UnipileClient(sdkBaseUrl, token);
    let verificationResponse;

    if (unipile.account && typeof unipile.account.solveCodeCheckpoint === 'function') {
      verificationResponse = await unipile.account.solveCodeCheckpoint({
        provider: 'LINKEDIN',
        account_id: unipileAccountId,
        code: otp
      });
    } else {
      // Fallback to HTTP
      const headers = baseService.getAuthHeaders();
      const response = await axios.post(
        `${baseUrl}/accounts/${unipileAccountId}/solve-checkpoint`,
        {
          type: 'OTP',
          code: otp
        },
        { headers, timeout: 30000 }
      );
      verificationResponse = response.data;
    }

    logger.info('[LinkedInCheckpointService] OTP verified successfully', { unipileAccountId });
    return verificationResponse;
  } catch (error) {
    logger.error('[LinkedInCheckpointService] Error verifying OTP', {
      unipileAccountId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  handleCheckpointResponse,
  solveCheckpoint,
  verifyOTP
};
