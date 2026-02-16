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
    
    // After successful OTP verification, fetch updated account status from Unipile
    try {
      // Wait a moment for Unipile to process the OTP
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch updated account details via HTTP (more reliable than SDK)
      const headers = baseService.getAuthHeaders();
      const accountResponse = await axios.get(
        `${baseUrl}/accounts/${unipileAccountId}`,
        { headers, timeout: 10000 }
      );
      
      const accountDetails = accountResponse.data;
      
      logger.info('[LinkedInCheckpointService] Fetched updated account status', {
        unipileAccountId,
        state: accountDetails?.state,
        status: accountDetails?.status,
        hasCheckpoint: !!accountDetails?.checkpoint?.required
      });
      
      // Update database if account is now active/connected
      const isConnected = accountDetails?.state === 'CONNECTED' || 
                         accountDetails?.state === 'connected' ||
                         accountDetails?.status === 'connected';
      const hasCheckpoint = accountDetails?.checkpoint && accountDetails.checkpoint.required === true;
      
      if (isConnected && !hasCheckpoint) {
        const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
        const repository = new LinkedInAccountRepository();
        
        await repository.updateAccountStatus(unipileAccountId, 'active', false);
        logger.info('[LinkedInCheckpointService] Updated database account status to active', { unipileAccountId });
      } else {
        logger.warn('[LinkedInCheckpointService] Account not yet fully connected after OTP', {
          unipileAccountId,
          isConnected,
          hasCheckpoint
        });
      }
    } catch (statusError) {
      // Don't fail the OTP verification if status check fails
      logger.warn('[LinkedInCheckpointService] Failed to update account status after OTP verification', {
        unipileAccountId,
        error: statusError.message
      });
    }
    
    return verificationResponse;
  } catch (error) {
    logger.error('[LinkedInCheckpointService] Error verifying OTP', {
      unipileAccountId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Verify OTP and save account to database (LAD Architecture compliant)
 * Service Layer: Orchestrates business logic
 * @param {string} unipileAccountId - Unipile account ID
 * @param {string} otp - OTP code
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @param {string} email - Email address
 * @param {string} schema - Database schema
 * @returns {Object} Verification result
 */
async function verifyOTPAndSaveAccount(unipileAccountId, otp, userId, tenantId, email, schema) {
  try {
    // Step 1: Verify OTP with Unipile
    const verificationResult = await verifyOTP(unipileAccountId, otp);
    
    logger.info('[LinkedInCheckpointService] OTP verified, fetching account details', { unipileAccountId });
    
    // Step 2: Get account details from Unipile
    const baseService = new UnipileBaseService();
    const { UnipileClient } = require('unipile-node-sdk');
    let sdkBaseUrl = baseService.getBaseUrl();
    
    // Clean up SDK base URL
    if (sdkBaseUrl.endsWith('/api/v1')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1$/, '');
    } else if (sdkBaseUrl.endsWith('/api/v1/')) {
      sdkBaseUrl = sdkBaseUrl.replace(/\/api\/v1\/$/, '');
    }
    
    const token = (baseService.dsn && baseService.token)
      ? baseService.token.trim()
      : (process.env.UNIPILE_TOKEN || '').trim();
    
    const unipile = new UnipileClient(sdkBaseUrl, token);
    const accountDetails = await unipile.account.getOne(unipileAccountId);
    
    logger.info('[LinkedInCheckpointService] Account details fetched', {
      unipileAccountId,
      state: accountDetails?.state,
      status: accountDetails?.status,
      hasCheckpoint: !!accountDetails?.checkpoint?.required
    });
    
    // Step 3: Check if account is ready (OTP verified and no checkpoint means it's connected)
    // After successful OTP verification, if there's no checkpoint required, account is ready to use
    const isConnected = accountDetails && !accountDetails.checkpoint?.required;
    
    if (isConnected) {
      // Step 4: Save account to database (call storage service)
      const linkedInAccountStorage = require('./LinkedInAccountStorageService');
      
      // Extract profile information from Unipile account details
      const profileName = accountDetails.name || 
                          accountDetails.display_name || 
                          accountDetails.username || 
                          (accountDetails.email ? accountDetails.email.split('@')[0] : 'LinkedIn User');
      
      const profileUrl = accountDetails.url || 
                        accountDetails.profile_url || 
                        (accountDetails.identifier?.startsWith('http') ? accountDetails.identifier : null);
      
      const accountEmail = email || 
                          accountDetails.email || 
                          accountDetails.profile?.email || 
                          null;
      
      // Build credentials object matching LinkedInAccountStorageService.saveLinkedInAccount signature
      const credentials = {
        unipile_account_id: unipileAccountId,
        profile_name: profileName,
        profile_url: profileUrl,
        email: accountEmail,
        connected_at: new Date().toISOString()
      };
      
      await linkedInAccountStorage.saveLinkedInAccount(userId, tenantId, credentials);
      
      logger.info('[LinkedInCheckpointService] Account saved to database', { 
        unipileAccountId,
        tenantId: tenantId?.substring(0, 8),
        profileName
      });
    } else {
      logger.warn('[LinkedInCheckpointService] Account still has checkpoint, not saving', {
        unipileAccountId,
        state: accountDetails?.state,
        status: accountDetails?.status,
        checkpointType: accountDetails?.checkpoint?.type,
        hasCheckpoint: !!accountDetails?.checkpoint?.required
      });
    }
    
    return {
      success: true,
      verified: true,
      accountSaved: isConnected,
      verificationResult
    };
    
  } catch (error) {
    logger.error('[LinkedInCheckpointService] Error in verifyOTPAndSaveAccount', {
      unipileAccountId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  handleCheckpointResponse,
  solveCheckpoint,
  verifyOTP,
  verifyOTPAndSaveAccount
};
