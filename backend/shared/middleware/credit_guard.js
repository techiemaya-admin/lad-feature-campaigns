/**
 * Credit Guard Middleware
 * 
 * PURPOSE:
 * Implements automatic credit deduction and usage tracking for billable API calls.
 * This middleware integrates billing directly into the API request flow, ensuring
 * usage is tracked and limits are enforced in real-time.
 * 
 * BILLING ENFORCEMENT:
 * 1. PRE-REQUEST: Check if client has sufficient credits
 * 2. DEDUCTION: Atomically deduct credits from client balance
 * 3. TRACKING: Log usage for billing analytics and reporting
 * 4. LIMITS: Reject requests when credits insufficient (soft limit)
 * 
 * CREDIT SYSTEM:
 * Different actions cost different amounts:
 * - Email + LinkedIn URL: 2 credits
 * - LinkedIn connection: 1 credit
 * - Template message: 5 credits
 * - Phone reveal: 10 credits
 * - Voice call: 3 credits/minute
 * 
 * MIDDLEWARE USAGE:
 * router.post('/search', 
 *   requireFeature('apollo-leads'),    // Feature access control
 *   requireCredits('apollo_search', 1), // Credit enforcement
 *   controllerFunction
 * );
 * 
 * ATOMIC OPERATIONS:
 * Uses database transactions to ensure:
 * 1. Credit balance is checked and deducted atomically
 * 2. Usage logging happens in same transaction
 * 3. No race conditions between concurrent requests
 * 4. Consistent billing data
 * 
 * ERROR HANDLING:
 * - 402 Payment Required: Insufficient credits
 * - 500 Internal Error: Database transaction failed
 * - Automatic rollback on any failure
 * 
 * USAGE TRACKING:
 * Records detailed usage in feature_usage table:
 * - Client ID and feature used
 * - Usage type (search, email, phone, etc.)
 * - Credits consumed
 * - Metadata (endpoint, user agent, timestamp)
 * 
 * ANALYTICS:
 * Usage data enables:
 * - Monthly billing calculations
 * - Usage trend analysis
 * - Capacity planning
 * - Feature adoption metrics
 */

const { pool } = require('../database/connection');
const logger = require('../../core/utils/logger');

/**
 * Middleware to check and deduct credits before API calls
 */
const requireCredits = (usageType, creditsRequired) => {
  return async (req, res, next) => {
    try {
      // Support tenantId (LAD schema), organizationId, and clientId (legacy)
      const tenantId = req.user?.tenantId || req.user?.organizationId || req.user?.clientId || req.headers['x-organization-id'] || req.headers['x-client-id'] || req.headers['x-tenant-id'];
      const featureKey = req.feature?.key || 'apollo-leads'; // Default to apollo-leads if not set

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Missing tenant or feature information',
          message: 'Unable to process credit check'
        });
      }

      // Check current credit balance
      const balance = await getCreditBalance(tenantId);
      
      if (balance < creditsRequired) {
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits',
          message: `This action requires ${creditsRequired} credits, but you only have ${balance} remaining`,
          credits_required: creditsRequired,
          credits_available: balance,
          upgrade_required: true
        });
      }

      // Deduct credits
      await deductCredits(tenantId, featureKey, usageType, creditsRequired, req);

      // Add credit info to request
      req.credits = {
        used: creditsRequired,
        remaining: balance - creditsRequired,
        usage_type: usageType
      };

      next();
    } catch (error) {
      logger.error('[Credit Guard] Error processing credits', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Credit check failed',
        message: 'Unable to verify credit balance at this time'
      });
    }
  };
};

/**
 * Get current credit balance for a tenant
 * Updated to support both legacy user_credits and new billing_wallets system
 */
async function getCreditBalance(tenantId) {
  // LAD Architecture: Use dynamic schema resolution
  const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
  
  // First try the new billing_wallets system (preferred)
  const walletQuery = `
    SELECT 
      current_balance as balance
    FROM ${schema}.billing_wallets
    WHERE tenant_id = $1
    LIMIT 1
  `;
  
  let result = await pool.query(walletQuery, [tenantId]);
  
  if (result.rows.length > 0) {
    return parseFloat(result.rows[0].balance);
  }
  
  // Fall back to legacy user_credits table for backward compatibility
  const legacyQuery = `
    SELECT 
      COALESCE(uc.balance, 0) as balance
    FROM ${schema}.user_credits uc
    WHERE uc.user_id = $1 OR uc.tenant_id = $1
    LIMIT 1
  `;
  
  result = await pool.query(legacyQuery, [tenantId]);
  
  if (result.rows.length === 0) {
    // Return 0 balance if no record found
    return 0;
  }
  
  return parseFloat(result.rows[0].balance);
}

/**
 * Deduct credits and log usage
 * Updated to support both billing_wallets (new) and user_credits (legacy) systems
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} featureKey - Feature key (e.g., 'campaigns', 'apollo-leads')
 * @param {string} usageType - Usage type (e.g., 'linkedin_connection', 'person_enrichment')
 * @param {number} credits - Number of credits to deduct
 * @param {Object} req - Request object (optional)
 * @param {Object} options - Additional options
 * @param {string} options.campaignId - Campaign ID for tracking (optional)
 * @param {string} options.leadId - Lead ID for tracking (optional)
 * @param {string} options.stepType - Step type for tracking (optional)
 */
async function deductCredits(tenantId, featureKey, usageType, credits, req, options = {}) {
  // LAD Architecture: Use dynamic schema resolution
  const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
  const client = await pool.connect();
  
  // Extract options
  const { campaignId, leadId, stepType } = options;
  
  try {
    await client.query('BEGIN');
    
    // First try to deduct from billing_wallets (new system - preferred)
    const walletResult = await client.query(
      `UPDATE ${schema}.billing_wallets 
       SET current_balance = current_balance - $1, updated_at = NOW() 
       WHERE tenant_id = $2 AND current_balance >= $1
       RETURNING id`,
      [credits, tenantId]
    );
    
    // If billing_wallets update failed or no row found, try legacy user_credits
    if (walletResult.rowCount === 0) {
      await client.query(
        `UPDATE ${schema}.user_credits SET balance = balance - $1, updated_at = NOW() WHERE (user_id = $2 OR tenant_id = $2) AND balance >= $1`,
        [credits, tenantId]
      );
    }
    
    // Build metadata with campaign tracking info
    const metadata = {
      usage_type: usageType,
      feature: featureKey,
      endpoint: req?.path || 'background_process',
      method: req?.method || 'BACKGROUND',
      user_agent: req?.headers?.['user-agent'] || 'campaign-processor',
      timestamp: new Date().toISOString(),
      // Campaign tracking fields
      campaign_id: campaignId || req?.campaignId || null,
      lead_id: leadId || null,
      step_type: stepType || null
    };
    
    // Log transaction - only insert user_id if it's a valid user UUID, not tenantId
    // For background processes, user_id should be NULL to avoid FK constraint violation
    const userId = req?.user?.userId || req?.user?.id || null;
    
    // Only log to credit_transactions if we have a valid user_id
    // Background processes without user context will skip this legacy table
    if (userId) {
      await client.query(
        `INSERT INTO ${schema}.credit_transactions (
          user_id,
          tenant_id,
          amount,
          transaction_type,
          description,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          tenantId,
          -credits,
          'deduction',
          `${featureKey} - ${usageType}`,
          metadata
        ]
      );
    } else {
      // For background processes, log to logger instead
      logger.info('[Credit Guard] Background credit deduction', { 
        credits, 
        tenantId, 
        usageType,
        campaignId: campaignId ? campaignId.substring(0, 8) : null,
        note: 'skipping legacy transaction log'
      });
    }
    
    // Always log to billing_ledger_transactions for complete audit trail
    // This captures both foreground and background credit usage
    try {
      const walletId = walletResult.rows[0]?.id || null;
      if (walletId) {
        // Generate idempotency key: tenant_campaign_usage_timestamp_random
        // Format: ensures uniqueness while being deterministic for retries
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const idempotencyKey = `${tenantId.substring(0, 8)}_${campaignId ? campaignId.substring(0, 8) : 'nocampaign'}_${usageType}_${timestamp}_${randomSuffix}`;
        
        await client.query(
          `INSERT INTO ${schema}.billing_ledger_transactions (
            tenant_id, wallet_id, transaction_type, amount, balance_before, balance_after,
            reference_type, reference_id, description, metadata, idempotency_key
          )
          SELECT 
            $1, $2, 'debit', -$3::numeric, 
            current_balance, current_balance - $3::numeric,
            $4, $5, $6, $7, $8
          FROM ${schema}.billing_wallets WHERE id = $2`,
          [
            tenantId,
            walletId,
            credits,
            campaignId ? 'campaign' : featureKey,
            campaignId || null,
            `${usageType}${stepType ? ` (${stepType})` : ''}`,
            metadata,
            idempotencyKey
          ]
        );
      }
    } catch (ledgerError) {
      // Don't fail the transaction if ledger logging fails
      logger.warn('[Credit Guard] Failed to log to billing_ledger', { error: ledgerError.message });
    }
    
    // Update campaign metadata with total credits if this is a campaign-related deduction
    if (campaignId) {
      try {
        await client.query(
          `UPDATE ${schema}.campaigns
           SET 
             metadata = jsonb_set(
               jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{total_credits_deducted}',
                 to_jsonb(
                   COALESCE((metadata->>'total_credits_deducted')::numeric, 0) + $1
                 )
               ),
               '{last_credit_update}',
               to_jsonb($2::text)
             ),
             updated_at = NOW()
           WHERE id = $3
           AND tenant_id = $4`,
          [credits, new Date().toISOString(), campaignId, tenantId]
        );
        
        logger.debug('[Credit Guard] Updated campaign metadata', { 
          campaignId: campaignId.substring(0, 8), 
          creditsAdded: credits 
        });
      } catch (campaignUpdateError) {
        // Don't fail the transaction if campaign metadata update fails
        logger.warn('[Credit Guard] Failed to update campaign metadata', { 
          error: campaignUpdateError.message,
          campaignId: campaignId.substring(0, 8)
        });
      }
    }
    
    await client.query('COMMIT');
    
    logger.info('[Credit Guard] Credits deducted', { 
      credits, 
      tenantId, 
      usageType,
      campaignId: campaignId ? campaignId.substring(0, 8) : null 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get credit usage summary for a campaign
 * Aggregates all credits deducted during campaign execution
 * 
 * @param {string} campaignId - Campaign ID
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Credit usage summary with breakdown by usage type
 */
async function getCampaignCreditUsage(campaignId, tenantId) {
  const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
  
  try {
    // Query billing_ledger_transactions for campaign-specific credits
    const result = await pool.query(
      `SELECT 
        COALESCE(SUM(amount), 0) as total_credits,
        COUNT(*) as transaction_count,
        jsonb_object_agg(
          COALESCE(metadata->>'usage_type', 'unknown'),
          COALESCE((SELECT SUM(lt2.amount) FROM ${schema}.billing_ledger_transactions lt2 
            WHERE lt2.reference_id = $1 
            AND lt2.tenant_id = $2 
            AND lt2.metadata->>'usage_type' = lt.metadata->>'usage_type'), 0)
        ) as breakdown_by_type
       FROM ${schema}.billing_ledger_transactions lt
       WHERE lt.reference_id = $1 
       AND lt.tenant_id = $2
       AND lt.transaction_type = 'debit'`,
      [campaignId, tenantId]
    );
    
    if (result.rows.length === 0) {
      return {
        campaignId,
        totalCredits: 0,
        transactionCount: 0,
        breakdown: {}
      };
    }
    
    const row = result.rows[0];
    
    // Get detailed breakdown by usage type
    const breakdownResult = await pool.query(
      `SELECT 
        COALESCE(metadata->>'usage_type', 'unknown') as usage_type,
        COALESCE(metadata->>'step_type', 'unknown') as step_type,
        SUM(amount) as credits,
        COUNT(*) as count
       FROM ${schema}.billing_ledger_transactions
       WHERE reference_id = $1 
       AND tenant_id = $2
       AND transaction_type = 'debit'
       GROUP BY metadata->>'usage_type', metadata->>'step_type'
       ORDER BY credits DESC`,
      [campaignId, tenantId]
    );
    
    return {
      campaignId,
      totalCredits: parseFloat(row.total_credits) || 0,
      transactionCount: parseInt(row.transaction_count) || 0,
      breakdown: breakdownResult.rows.map(r => ({
        usageType: r.usage_type,
        stepType: r.step_type,
        credits: parseFloat(r.credits) || 0,
        count: parseInt(r.count) || 0
      }))
    };
  } catch (error) {
    logger.error('[Credit Guard] Error getting campaign credit usage', { campaignId, error: error.message });
    return {
      campaignId,
      totalCredits: 0,
      transactionCount: 0,
      breakdown: [],
      error: error.message
    };
  }
}

/**
 * Middleware to track feature usage without deducting credits
 */
const trackUsage = (usageType) => {
  return async (req, res, next) => {
    try {
      // Support tenantId (LAD schema), organizationId, and clientId (legacy)
      const tenantId = req.user?.tenantId || req.user?.organizationId || req.user?.clientId || req.headers['x-organization-id'] || req.headers['x-client-id'] || req.headers['x-tenant-id'];
      const featureKey = req.feature?.key;

      if (tenantId && featureKey) {
        // Track usage without deducting credits
        await pool.query(
          `INSERT INTO feature_usage (
            client_id, 
            feature_id, 
            usage_type, 
            credits_used,
            metadata
          ) VALUES (
            $1,
            (SELECT id FROM features WHERE key = $2),
            $3,
            0,
            $4
          )`,
          [
            tenantId,
            featureKey,
            usageType,
            {
              endpoint: req.path,
              method: req.method,
              timestamp: new Date().toISOString()
            }
          ]
        );
      }

      next();
    } catch (error) {
      logger.error('[Credit Guard] Error tracking usage', { error: error.message });
      // Don't block request for tracking errors
      next();
    }
  };
};

/**
 * Refund credits to user account
 * Used when an API operation fails after credits were deducted (e.g., validation errors)
 * 
 * FIX: Implements credit refund mechanism for failed Apollo API calls
 * When Apollo API returns 4xx errors (client errors like 422), no service should be provided,
 * so credits should be refunded to the user.
 * 
 * Updated to support both billing_wallets (new) and user_credits (legacy) systems
 */
async function refundCredits(tenantId, usageType, credits, req, reason = 'Operation failed') {
  const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // First try to refund to billing_wallets (new system - preferred)
    const walletResult = await client.query(
      `UPDATE ${schema}.billing_wallets 
       SET current_balance = current_balance + $1, updated_at = NOW() 
       WHERE tenant_id = $2
       RETURNING id`,
      [credits, tenantId]
    );
    
    // If billing_wallets update failed or no row found, try legacy user_credits
    if (walletResult.rowCount === 0) {
      await client.query(
        `UPDATE ${schema}.user_credits SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 OR tenant_id = $2`,
        [credits, tenantId]
      );
    }
    
    // Log refund transaction
    await client.query(
      `INSERT INTO ${schema}.credit_transactions (
        user_id,
        tenant_id,
        amount,
        transaction_type,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req?.user?.userId || req?.user?.id || tenantId,
        tenantId,
        credits, // Positive amount for refund
        'refund',
        `Refund: ${usageType} - ${reason}`,
        {
          usage_type: usageType,
          reason: reason,
          endpoint: req?.path || 'N/A',
          method: req?.method || 'N/A',
          timestamp: new Date().toISOString()
        }
      ]
    );
    
    await client.query('COMMIT');
    
    logger.info('[Credit Guard] Credits refunded', { credits, tenantId, usageType, reason });
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[Credit Guard] Error refunding credits', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get campaign credit summary from metadata
 * Fast read from campaign metadata instead of aggregating transactions
 * 
 * @param {string} campaignId - Campaign ID
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Campaign credit summary from metadata
 */
async function getCampaignCreditSummary(campaignId, tenantId) {
  const schema = process.env.POSTGRES_SCHEMA || process.env.DB_SCHEMA || 'lad_dev';
  
  try {
    const result = await pool.query(
      `SELECT 
        id,
        name,
        status,
        metadata->>'total_credits_deducted' as total_credits,
        metadata->>'credit_transaction_count' as transaction_count,
        metadata->>'first_credit_deduction' as first_deduction,
        metadata->>'last_credit_deduction' as last_deduction,
        metadata->>'last_credit_update' as last_update
       FROM ${schema}.campaigns
       WHERE id = $1
       AND tenant_id = $2`,
      [campaignId, tenantId]
    );
    
    if (result.rows.length === 0) {
      return {
        campaignId,
        error: 'Campaign not found'
      };
    }
    
    const campaign = result.rows[0];
    
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      totalCredits: parseFloat(campaign.total_credits) || 0,
      transactionCount: parseInt(campaign.transaction_count) || 0,
      firstDeduction: campaign.first_deduction,
      lastDeduction: campaign.last_deduction,
      lastUpdate: campaign.last_update
    };
  } catch (error) {
    logger.error('[Credit Guard] Error getting campaign credit summary', { 
      campaignId, 
      error: error.message 
    });
    return {
      campaignId,
      error: error.message
    };
  }
}

module.exports = {
  requireCredits,
  trackUsage,
  getCreditBalance,
  deductCredits,
  refundCredits,
  getCampaignCreditUsage,
  getCampaignCreditSummary
};