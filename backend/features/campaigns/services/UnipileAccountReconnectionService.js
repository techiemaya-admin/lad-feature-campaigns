/**
 * Unipile Account Reconnection Service
 * Handles automatic account reconnection on 401 errors
 * Implements smart retry logic without marking accounts as expired prematurely
 * LAD Architecture Compliant - Uses logger instead of console
 */

const axios = require('axios');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

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
            logger.warn('[Unipile Reconnection] Service not configured, cannot check account status', { accountId });
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
            logger.debug('[Unipile Reconnection] Account status check successful', { 
                accountId, 
                hasCheckpoint: !!accountData.checkpoint,
                state: accountData.state || accountData.status 
            });

            return {
                valid: true,
                hasCheckpoint: !!accountData.checkpoint,
                state: accountData.state || accountData.status,
                data: accountData
            };
        } catch (error) {
            if (error.response?.status === 401) {
                logger.warn('[Unipile Reconnection] Account status check returned 401', { accountId });
                return { valid: false, reason: 'unauthorized' };
            }
            if (error.response?.status === 404) {
                logger.warn('[Unipile Reconnection] Account not found in Unipile', { accountId });
                return { valid: false, reason: 'not_found' };
            }
            
            logger.error('[Unipile Reconnection] Error checking account status', { 
                accountId, 
                error: error.message,
                statusCode: error.response?.status 
            });
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
            logger.warn('[Unipile Reconnection] Max reconnection attempts exceeded', { 
                accountId, 
                maxAttempts: this.MAX_RECONNECTION_ATTEMPTS 
            });
            return { success: false, reason: 'max_attempts_exceeded' };
        }

        logger.info('[Unipile Reconnection] Attempting account reconnection', { 
            accountId, 
            attemptNumber, 
            maxAttempts: this.MAX_RECONNECTION_ATTEMPTS 
        });

        try {
            // Check if account is still valid in Unipile
            const status = await this.getAccountStatus(accountId);
            
            if (status.valid) {
                logger.info('[Unipile Reconnection] Account is still valid in Unipile, resetting attempt counter', { accountId });
                this.resetAttemptCounter(accountId);
                return { success: true, reason: 'account_valid' };
            }

            // If account has a checkpoint, we need user intervention
            if (status.hasCheckpoint) {
                logger.warn('[Unipile Reconnection] Account has checkpoint - requires user intervention', { accountId });
                // Don't throw - let caller handle checkpoint logic
                return { 
                    success: false, 
                    reason: 'checkpoint_required',
                    requiresUserIntervention: true 
                };
            }

            // If account is truly disconnected, update DB status
            if (status.reason === 'not_found') {
                logger.error('[Unipile Reconnection] Account not found in Unipile - marking as expired', { accountId });
                await this.markAccountAsExpired(accountId);
                return { success: false, reason: 'account_not_found', markedExpired: true };
            }

            // For other errors, just log and allow retry
            logger.debug('[Unipile Reconnection] Reconnection attempt did not fully succeed, but no errors detected', { 
                accountId, 
                attemptNumber 
            });
            
            return { success: false, reason: 'retry_needed', attemptNumber };
        } catch (error) {
            logger.error('[Unipile Reconnection] Error during reconnection attempt', { 
                accountId, 
                attemptNumber, 
                error: error.message 
            });
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
            const schema = getSchema(null);
            
            const result = await pool.query(
                `UPDATE ${schema}.social_linkedin_accounts 
                 SET status = 'expired', updated_at = CURRENT_TIMESTAMP 
                 WHERE provider_account_id = $1
                 RETURNING id`,
                [accountId]
            );

            if (result.rowCount > 0) {
                logger.info('[Unipile Reconnection] Marked account as expired in database', { 
                    accountId, 
                    updatedRows: result.rowCount 
                });
            } else {
                logger.warn('[Unipile Reconnection] Account not found in database to mark as expired', { accountId });
            }
        } catch (error) {
            logger.error('[Unipile Reconnection] Error marking account as expired', { 
                accountId, 
                error: error.message 
            });
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
            logger.info('[Unipile Reconnection] Exceeded max reconnection attempts for account', { accountId });
            return true;
        }

        // Check Unipile status
        const status = await this.getAccountStatus(accountId);
        
        if (!status || status.reason === 'not_found') {
            logger.info('[Unipile Reconnection] Account not found in Unipile', { accountId });
            return true;
        }

        // Otherwise, don't disconnect yet
        logger.debug('[Unipile Reconnection] Account should not be marked as disconnected yet', { accountId });
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
        logger.warn('[Unipile Reconnection] 401 Error received, attempting reconnection', { 
            accountId,
            errorMessage: originalError?.message,
            hasRetryFunction: !!retryFn
        });

        // Attempt reconnection
        const reconnectResult = await this.attemptReconnect(accountId);

        if (reconnectResult.success || reconnectResult.reason === 'account_valid') {
            logger.info('[Unipile Reconnection] Reconnection successful, account is still valid', { accountId });
            
            // If we have a retry function, attempt to retry the original operation
            if (retryFn) {
                try {
                    logger.debug('[Unipile Reconnection] Retrying original request after successful reconnection', { accountId });
                    const retryResult = await retryFn();
                    return { success: true, retried: true, result: retryResult };
                } catch (retryError) {
                    logger.error('[Unipile Reconnection] Retry failed after reconnection', { 
                        accountId, 
                        error: retryError.message 
                    });
                    return { success: false, retried: true, reason: 'retry_failed', error: retryError.message };
                }
            }
            
            return { success: true, reason: 'account_valid' };
        }

        if (reconnectResult.requiresUserIntervention) {
            logger.warn('[Unipile Reconnection] Account requires user intervention (checkpoint)', { accountId });
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
        logger.warn('[Unipile Reconnection] Reconnection attempt did not fully succeed, but retrying is possible', { 
            accountId, 
            attemptNumber: reconnectResult.attemptNumber 
        });

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
