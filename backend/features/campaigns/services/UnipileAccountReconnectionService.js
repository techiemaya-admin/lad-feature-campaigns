/**
 * Unipile Account Reconnection Service
 * Handles automatic account reconnection on 401 errors
 * Implements smart retry logic without marking accounts as expired prematurely
 * LAD Architecture Compliant - Uses logger instead of console
 */

const axios = require('axios');
const { getSchema } = require('../../../core/utils/schemaHelper');
class UnipileAccountReconnectionService {
    constructor(baseService) {
        this.base = baseService;
        // Track reconnection attempts to avoid infinite loops
        this.reconnectionAttempts = new Map();
        this.MAX_RECONNECTION_ATTEMPTS = 3;
        this.ATTEMPT_TIMEOUT_MS = 300000; // 5 minutes
    }
    /**
     * Increment reconnection attempt counter for an account
     * Prevents infinite retry loops
     */
    incrementAttemptCounter(accountId) {
        const now = Date.now();
        const attempt = this.reconnectionAttempts.get(accountId) || { count: 0, lastAttempt: 0 };
        // Reset counter if timeout exceeded
        if (now - attempt.lastAttempt > this.ATTEMPT_TIMEOUT_MS) {
            attempt.count = 0;
        }
        attempt.count++;
        attempt.lastAttempt = now;
        this.reconnectionAttempts.set(accountId, attempt);
        return attempt.count;
    }
    /**
     * Reset reconnection attempts for an account (on successful reconnect)
     */
    resetAttemptCounter(accountId) {
        this.reconnectionAttempts.delete(accountId);
    }
    /**
     * Check if we've exceeded max reconnection attempts
     */
    canAttemptReconnect(accountId) {
        const attempt = this.reconnectionAttempts.get(accountId) || { count: 0 };
        return attempt.count < this.MAX_RECONNECTION_ATTEMPTS;
    }
    /**
     * Get account status from Unipile
     * Attempts to fetch account details to check if it's still valid
     */
    async getAccountStatus(accountId) {
        if (!this.base.isConfigured()) {
            return null;
        }
        try {
            const baseUrl = this.base.getBaseUrl();
            const headers = this.base.getAuthHeaders();
            const response = await axios.get(
                `${baseUrl}/accounts/${accountId}`,
                { headers, timeout: 10000 }
            );
            const accountData = response.data?.data || response.data || {};
            
            return {
                valid: true,
                hasCheckpoint: !!accountData.checkpoint,
                state: accountData.state || accountData.status,
                data: accountData
            };
        } catch (error) {
            if (error.response?.status === 401) {
                return { valid: false, reason: 'unauthorized' };
            }
            if (error.response?.status === 404) {
                return { valid: false, reason: 'not_found' };
            }
            return { valid: false, reason: 'error', error: error.message };
        }
    }
    /**
     * Attempt to reconnect/refresh account credentials
     * This is a placeholder for the actual reconnection logic
     * In a real scenario, this would trigger re-authentication
     */
    async attemptReconnect(accountId) {
        const attemptNumber = this.incrementAttemptCounter(accountId);
        if (!this.canAttemptReconnect(accountId)) {
            return { success: false, reason: 'max_attempts_exceeded' };
        }
        
        try {
            // Check if account is still valid in Unipile
            const status = await this.getAccountStatus(accountId);
            if (status.valid) {
                this.resetAttemptCounter(accountId);
                return { success: true, reason: 'account_valid' };
            }
            // If account has a checkpoint, we need user intervention
            if (status.hasCheckpoint) {
                // Don't throw - let caller handle checkpoint logic
                return { 
                    success: false, 
                    reason: 'checkpoint_required',
                    requiresUserIntervention: true 
                };
            }
            // If account is truly disconnected, update DB status
            if (status.reason === 'not_found') {
                await this.markAccountAsExpired(accountId);
                return { success: false, reason: 'account_not_found', markedExpired: true };
            }
            // For other errors, just log and allow retry
            return { success: false, reason: 'retry_needed', attemptNumber };
        } catch (error) {
            return { success: false, reason: 'error', error: error.message, attemptNumber };
        }
    }
    /**
     * Mark account as expired in database (only when truly expired)
     * Called only when we're certain the account is gone or user explicitly disconnected
     */
    async markAccountAsExpired(accountId) {
        try {
            const { pool } = require('../../../shared/database/connection');
            const schema = getSchema(req);
            const result = await pool.query(
                `UPDATE ${schema}.social_linkedin_accounts 
                 SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                 WHERE provider_account_id = $1
                 RETURNING id`,
                [accountId]
            );
            if (result.rowCount > 0) {
            } else {
            }
        } catch (error) {
        }
    }
    /**
     * Check if account truly needs disconnection
     * Returns true only if:
     * 1. User explicitly disconnected from UI
     * 2. Account truly doesn't exist in Unipile
     * 3. Multiple reconnection attempts failed
     */
    async shouldMarkAccountAsDisconnected(accountId) {
        // Check if we've exceeded max attempts
        if (!this.canAttemptReconnect(accountId)) {
            return true;
        }
        // Check Unipile status
        const status = await this.getAccountStatus(accountId);
        if (!status || status.reason === 'not_found') {
            return true;
        }
        // Otherwise, don't disconnect yet
        return false;
    }
    /**
     * Handle 401 error with automatic reconnection attempt
     * This is called when we get a 401 during normal operations
     * 
     * @param {string} accountId - Unipile account ID
     * @param {Object} originalError - The original axios error
     * @param {Function} retryFn - Optional function to retry the original request after reconnect
     * @returns {Object} - Reconnection result
     */
    async handle401Error(accountId, originalError, retryFn = null) {
        // Attempt reconnection
        const reconnectResult = await this.attemptReconnect(accountId);
        if (reconnectResult.success || reconnectResult.reason === 'account_valid') {
            // If we have a retry function, attempt to retry the original operation
            if (retryFn) {
                try {
                    const retryResult = await retryFn();
                    return { success: true, retried: true, result: retryResult };
                } catch (retryError) {
                    return { success: false, retried: true, reason: 'retry_failed', error: retryError.message };
                }
            }
            return { success: true, reason: 'account_valid' };
        }
        if (reconnectResult.requiresUserIntervention) {
            return { 
                success: false, 
                reason: 'checkpoint_required',
                requiresUserIntervention: true,
                userMessage: 'LinkedIn account requires re-authentication. Please reconnect your account.'
            };
        }
        if (reconnectResult.markedExpired) {
            return { 
                success: false, 
                reason: 'account_expired',
                userMessage: 'LinkedIn account not found in Unipile. Please reconnect your account.'
            };
        }
        // Retry logic: on transient errors, don't fail immediately
        return { 
            success: false, 
            reason: 'transient_error',
            attemptNumber: reconnectResult.attemptNumber,
            canRetry: true,
            userMessage: 'Temporary connection issue. Your request will retry automatically.'
        };
    }
}
module.exports = UnipileAccountReconnectionService;
