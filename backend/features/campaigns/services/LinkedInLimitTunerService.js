/**
 * LinkedIn Limit Tuner Service
 * LAD Architecture: Service Layer — no SQL, no HTTP framework logic.
 * 
 * PURPOSE:
 * Automatically detects and adjusts LinkedIn connection request limits
 * per account based on real-time rate limit feedback from LinkedIn (via Unipile).
 * 
 * HOW IT WORKS:
 * 1. We start with default limits (e.g., 20/day, 140/week)
 * 2. When LinkedIn blocks a connection request (Unipile returns isRateLimit: true),
 *    the system counts how many successful connections the account sent this week
 * 3. That count IS the real LinkedIn limit for this account
 * 4. Stores it in detected_weekly_limit and updates default_daily_limit + default_weekly_limit
 * 5. If a full week passes with NO rate limit errors, limits stay the same (working fine)
 * 
 * USES:
 * - Existing columns: default_daily_limit, default_weekly_limit (auto-updated)
 * - 1 new column: detected_weekly_limit (stores the real LinkedIn limit)
 */

const { pool } = require('../../../shared/database/connection');
const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
const logger = require('../../../core/utils/logger');

// Safety floor — never auto-tune below these values
const MIN_DAILY_LIMIT = 5;
const MIN_WEEKLY_LIMIT = 20;

class LinkedInLimitTunerService {
    constructor() {
        this.repository = new LinkedInAccountRepository(pool);
    }

    /**
     * Called when a rate limit is detected from LinkedIn (Unipile returns isRateLimit: true)
     * This is the core auto-tuning trigger.
     * 
     * LAD Architecture: Service Layer — business logic only, SQL delegated to repository
     * 
     * @param {string} tenantId - Tenant ID
     * @param {string} providerAccountId - The Unipile/LinkedIn account ID that hit the limit
     * @param {string} campaignId - Campaign ID (for logging)
     */
    async onRateLimitHit(tenantId, providerAccountId, campaignId) {
        try {
            logger.info('[LinkedInLimitTuner] Rate limit detected — starting auto-tune analysis', {
                tenantId,
                providerAccountId,
                campaignId
            });

            // Step 1: Find the account row in the DB using the provider_account_id
            const account = await this.repository.getAccountByProviderIdForTenant(tenantId, providerAccountId);

            if (!account) {
                logger.warn('[LinkedInLimitTuner] Account not found for provider ID — skipping auto-tune', {
                    tenantId,
                    providerAccountId
                });
                return;
            }

            // Step 2: Count how many successful connections this account sent in the last 7 days
            const weeklyCount = await this.repository.getWeeklyConnectionCountForAccount(
                tenantId,
                providerAccountId
            );

            logger.info('[LinkedInLimitTuner] Weekly connection count for rate-limited account', {
                accountId: account.id,
                accountName: account.account_name,
                providerAccountId,
                weeklyCount,
                currentWeeklyLimit: account.default_weekly_limit,
                currentDailyLimit: account.default_daily_limit
            });

            // Step 3: If the weekly count is already >= the configured limit,
            // it means our configured limit is correct (or too low). No tuning needed.
            if (weeklyCount >= account.default_weekly_limit) {
                logger.info('[LinkedInLimitTuner] Weekly count >= configured limit — no tuning needed', {
                    weeklyCount,
                    configuredWeeklyLimit: account.default_weekly_limit
                });
                return;
            }

            // Step 4: The weekly count IS the real LinkedIn limit for this account
            // LinkedIn blocked at this number, so this is the ceiling
            const learnedWeeklyLimit = Math.max(weeklyCount, MIN_WEEKLY_LIMIT);
            const learnedDailyLimit = Math.max(Math.floor(learnedWeeklyLimit / 7), MIN_DAILY_LIMIT);

            // Step 5: Only update if the learned limit is meaningfully lower than current
            if (learnedWeeklyLimit >= account.default_weekly_limit) {
                logger.info('[LinkedInLimitTuner] Learned limit is not lower than current — skipping update', {
                    learnedWeeklyLimit,
                    currentWeeklyLimit: account.default_weekly_limit
                });
                return;
            }

            // Step 6: Update the database — sets default_daily_limit, default_weekly_limit, AND detected_weekly_limit
            const updated = await this.repository.updateAccountLimits(
                account.id,
                tenantId,
                learnedDailyLimit,
                learnedWeeklyLimit
            );

            if (updated) {
                logger.info('[LinkedInLimitTuner] ✅ Auto-tuned LinkedIn account limits', {
                    accountId: account.id,
                    accountName: account.account_name,
                    providerAccountId,
                    previousDailyLimit: account.default_daily_limit,
                    previousWeeklyLimit: account.default_weekly_limit,
                    newDailyLimit: learnedDailyLimit,
                    newWeeklyLimit: learnedWeeklyLimit,
                    detectedWeeklyLimit: learnedWeeklyLimit,
                    weeklyConnectionsAtBlock: weeklyCount,
                    campaignId
                });
            }
        } catch (error) {
            // CRITICAL: Never let tuning errors break campaign execution
            logger.error('[LinkedInLimitTuner] Error during auto-tune (non-fatal)', {
                tenantId,
                providerAccountId,
                campaignId,
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Get current limit info for an account (useful for frontend display)
     * LAD Architecture: Service Layer — delegates SQL to repository
     * 
     * @param {string} accountId - Account UUID
     * @param {string} tenantId - Tenant ID
     * @returns {Promise<Object|null>} Limit info with tuning status
     */
    async getAccountLimitInfo(accountId, tenantId) {
        try {
            const account = await this.repository.getAccountLimitsById(accountId, tenantId);

            if (!account) return null;

            return {
                accountId: account.id,
                providerAccountId: account.provider_account_id,
                accountName: account.account_name,
                dailyLimit: account.default_daily_limit,
                weeklyLimit: account.default_weekly_limit,
                detectedWeeklyLimit: account.detected_weekly_limit,
                isTuned: account.detected_weekly_limit !== null
            };
        } catch (error) {
            logger.error('[LinkedInLimitTuner] Error getting account limit info', {
                accountId,
                tenantId,
                error: error.message
            });
            return null;
        }
    }
}

// Singleton instance
const linkedInLimitTuner = new LinkedInLimitTunerService();
module.exports = { linkedInLimitTuner };
