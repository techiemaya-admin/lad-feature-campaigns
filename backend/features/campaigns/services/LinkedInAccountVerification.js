/**
 * LinkedIn Account Verification Service
 * Handles account health checks and validation
 */

const logger = require('../../../core/utils/logger');

/**
 * Verify account health with Unipile
 */
async function verifyAccountHealth(unipileAccountId) {
  try {
    const unipileService = require('./unipileService');
    const baseService = unipileService.base;
    
    if (!baseService.isConfigured()) {
      return { valid: false, error: 'Unipile not configured' };
    }
    
    const baseUrl = baseService.getBaseUrl();
    const headers = baseService.getAuthHeaders();
    
    const axios = require('axios');
    const response = await axios.get(
      `${baseUrl}/accounts/${unipileAccountId}`,
      { headers, timeout: 10000 }
    );
    
    const accountData = response.data?.data || response.data || {};
    
    if (accountData.checkpoint) {
      return { 
        valid: false, 
        error: 'Account requires checkpoint resolution',
        hasCheckpoint: true,
        checkpointType: accountData.checkpoint.type
      };
    }
    
    const state = accountData.state || accountData.status || '';
    if (state === 'disconnected' || state === 'error' || state === 'expired') {
      return { valid: false, error: `Account state: ${state}` };
    }
    
    return { valid: true, account: accountData };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      return { valid: false, error: 'Account credentials expired', expired: true };
    }
    if (error.response && error.response.status === 404) {
      return { valid: false, error: 'Account not found in Unipile', notFound: true };
    }
    return { valid: true, warning: error.message };
  }
}

module.exports = {
  verifyAccountHealth
};
