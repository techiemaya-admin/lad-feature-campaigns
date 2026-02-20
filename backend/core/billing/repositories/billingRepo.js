const { query } = require('../../../config/database');

/**
 * Billing Repository - Centralized database queries for billing operations
 * All queries are tenant-scoped for security
 */

// =============================================================================
// PRICING CATALOG
// =============================================================================

/**
 * Resolve price for a specific usage component
 * Priority: tenant-specific override > global default
 * Falls back to model='*' wildcard if exact model not found
 * 
 * @param {Object} params
 * @param {string} params.tenantId - Tenant UUID
 * @param {string} params.category - Usage category (stt, llm, tts, telephony, etc.)
 * @param {string} params.provider - Provider name
 * @param {string} params.model - Model name or '*' for default
 * @param {string} params.unit - Unit of measurement
 * @param {Date} params.atTime - Effective time (defaults to now)
 * @returns {Promise<Object|null>} Price record or null
 */
async function resolvePrice({ tenantId, category, provider, model, unit, atTime = new Date() }) {
  const sql = `
    SELECT id, tenant_id, category, provider, model, unit, unit_price, description, metadata
    FROM billing_pricing_catalog
    WHERE category = $1
      AND provider = $2
      AND unit = $3
      AND is_active = true
      AND (effective_from IS NULL OR effective_from <= $4)
      AND (effective_to IS NULL OR effective_to > $4)
      AND (
        -- Tenant-specific match (highest priority)
        (tenant_id = $5 AND model = $6)
        -- Tenant wildcard
        OR (tenant_id = $5 AND model = '*')
        -- Global match
        OR (tenant_id IS NULL AND model = $6)
        -- Global wildcard (lowest priority)
        OR (tenant_id IS NULL AND model = '*')
      )
    ORDER BY
      -- Prioritize tenant overrides
      CASE WHEN tenant_id = $5 THEN 1 ELSE 2 END,
      -- Prioritize exact model match
      CASE WHEN model = $6 THEN 1 ELSE 2 END,
      -- Most recent effective_from
      effective_from DESC NULLS LAST
    LIMIT 1
  `;
  
  const result = await query(sql, [category, provider, unit, atTime, tenantId, model]);
  return result.rows[0] || null;
}

/**
 * Get all active pricing for a tenant (includes global defaults)
 */
async function listPricing({ tenantId, category, provider }) {
  let sql = `
    SELECT id, tenant_id, category, provider, model, unit, unit_price, description, 
           effective_from, effective_to, metadata, is_active
    FROM billing_pricing_catalog
    WHERE (tenant_id = $1 OR tenant_id IS NULL)
      AND is_active = true
  `;
  
  const params = [tenantId];
  let paramIndex = 2;
  
  if (category) {
    sql += ` AND category = $${paramIndex++}`;
    params.push(category);
  }
  
  if (provider) {
    sql += ` AND provider = $${paramIndex++}`;
    params.push(provider);
  }
  
  sql += ` ORDER BY category, provider, model`;
  
  const result = await query(sql, params);
  return result.rows;
}

// =============================================================================
// WALLETS
// =============================================================================

/**
 * Get or create tenant wallet (with row lock for updates)
 * @param {string} tenantId - Tenant UUID
 * @param {boolean} forUpdate - Lock row for update
 * @returns {Promise<Object>} Wallet record
 */
async function getOrCreateWallet(tenantId, forUpdate = false) {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  
  // Try to get existing wallet - first check for tenant-level wallet (user_id IS NULL)
  // then fallback to any wallet for this tenant
  let sql = `
    SELECT id, tenant_id, user_id, current_balance, reserved_balance, currency, 
           status, low_balance_threshold, metadata, created_at, updated_at
    FROM billing_wallets
    WHERE tenant_id = $1
    ORDER BY user_id NULLS FIRST
    LIMIT 1
    ${lockClause}
  `;
  
  let result = await query(sql, [tenantId]);
  
  if (result.rows.length > 0) {
    return result.rows[0];
  }
  
  // Create if doesn't exist (only if not locked)
  if (!forUpdate) {
    // Use a separate check-then-insert approach since ON CONFLICT doesn't work
    // reliably with NULL values in the unique constraint
    sql = `
      INSERT INTO billing_wallets (tenant_id, user_id, current_balance, currency, status)
      SELECT $1, NULL, 0, 'USD', 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_wallets WHERE tenant_id = $1 AND user_id IS NULL
      )
      RETURNING *
    `;
    result = await query(sql, [tenantId]);
    
    // If insert succeeded, return the new row
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    
    // If insert didn't happen (wallet exists), fetch it
    sql = `
      SELECT id, tenant_id, user_id, current_balance, reserved_balance, currency, 
             status, low_balance_threshold, metadata, created_at, updated_at
      FROM billing_wallets
      WHERE tenant_id = $1 AND user_id IS NULL
    `;
    result = await query(sql, [tenantId]);
    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }
  
  throw new Error(`Wallet not found for tenant ${tenantId}`);
}

/**
 * Update wallet balance (must be in transaction with ledger insert)
 */
async function updateWalletBalance(walletId, newBalance, client) {
  const sql = `
    UPDATE billing_wallets
    SET current_balance = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;
  
  const result = client ? await client.query(sql, [newBalance, walletId]) : await query(sql, [newBalance, walletId]);
  return result.rows[0];
}

/**
 * Check if wallet has sufficient balance
 */
async function checkSufficientBalance(tenantId, requiredAmount) {
  const sql = `
    SELECT current_balance >= $1 as sufficient, current_balance
    FROM billing_wallets
    WHERE tenant_id = $2 AND user_id IS NULL
  `;
  
  const result = await query(sql, [requiredAmount, tenantId]);
  if (result.rows.length === 0) return { sufficient: false, current_balance: 0 };
  return result.rows[0];
}

// =============================================================================
// LEDGER TRANSACTIONS
// =============================================================================

/**
 * Create ledger transaction (atomic with wallet update)
 * MUST be called within a transaction
 */
async function createLedgerTransaction({
  tenantId,
  walletId,
  transactionType,
  amount,
  balanceBefore,
  balanceAfter,
  referenceType,
  referenceId,
  idempotencyKey,
  createdBy,
  description,
  metadata,
  client
}) {
  const sql = `
    INSERT INTO billing_ledger_transactions (
      tenant_id, wallet_id, transaction_type, amount, balance_before, balance_after,
      reference_type, reference_id, idempotency_key, created_by, description, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;
  
  const result = await client.query(sql, [
    tenantId, walletId, transactionType, amount, balanceBefore, balanceAfter,
    referenceType, referenceId, idempotencyKey, createdBy, description,
    metadata || {}
  ]);
  
  return result.rows[0];
}

/**
 * Get ledger transaction by idempotency key
 */
async function getLedgerByIdempotencyKey(tenantId, idempotencyKey) {
  const sql = `
    SELECT * FROM billing_ledger_transactions
    WHERE tenant_id = $1 AND idempotency_key = $2
  `;
  
  const result = await query(sql, [tenantId, idempotencyKey]);
  return result.rows[0] || null;
}

/**
 * List ledger transactions with pagination
 */
async function listLedgerTransactions({ tenantId, walletId, fromDate, toDate, limit = 100, offset = 0 }) {
  let sql = `
    SELECT lt.*, w.tenant_id as wallet_tenant_id, u.email as created_by_email
    FROM billing_ledger_transactions lt
    LEFT JOIN billing_wallets w ON lt.wallet_id = w.id
    LEFT JOIN users u ON lt.created_by = u.id
    WHERE lt.tenant_id = $1
  `;
  
  const params = [tenantId];
  let paramIndex = 2;
  
  if (walletId) {
    sql += ` AND lt.wallet_id = $${paramIndex++}`;
    params.push(walletId);
  }
  
  if (fromDate) {
    sql += ` AND lt.created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND lt.created_at < $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += ` ORDER BY lt.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  return result.rows;
}

// =============================================================================
// USAGE EVENTS
// =============================================================================

/**
 * Create usage event
 */
async function createUsageEvent({
  tenantId,
  userId,
  featureKey,
  usageItems,
  totalQuantity,
  totalCost,
  currency,
  idempotencyKey,
  externalReferenceId,
  metadata
}) {
  const sql = `
    INSERT INTO billing_usage_events (
      tenant_id, user_id, feature_key, usage_items, total_quantity, total_cost,
      currency, status, idempotency_key, external_reference_id, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
    RETURNING *
  `;
  
  const result = await query(sql, [
    tenantId, userId, featureKey, JSON.stringify(usageItems), totalQuantity,
    totalCost, currency, idempotencyKey, externalReferenceId, metadata || {}
  ]);
  
  return result.rows[0];
}

/**
 * Get usage event by idempotency key
 */
async function getUsageByIdempotencyKey(tenantId, idempotencyKey) {
  const sql = `
    SELECT * FROM billing_usage_events
    WHERE tenant_id = $1 AND idempotency_key = $2
  `;
  
  const result = await query(sql, [tenantId, idempotencyKey]);
  return result.rows[0] || null;
}

/**
 * Get usage event by ID
 */
async function getUsageEventById(id, tenantId) {
  const sql = `
    SELECT * FROM billing_usage_events
    WHERE id = $1 AND tenant_id = $2
  `;
  
  const result = await query(sql, [id, tenantId]);
  return result.rows[0] || null;
}

/**
 * Update usage event status (e.g., charged, failed)
 */
async function updateUsageEventStatus({
  id,
  status,
  ledgerTransactionId,
  errorMessage,
  client
}) {
  const sql = `
    UPDATE billing_usage_events
    SET status = $1::VARCHAR,
        ledger_transaction_id = $2,
        charged_at = CASE WHEN $1::VARCHAR = 'charged' THEN NOW() ELSE charged_at END,
        error_message = $3,
        retry_count = retry_count + 1,
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `;
  
  const result = client ? await client.query(sql, [status, ledgerTransactionId, errorMessage, id]) : await query(sql, [status, ledgerTransactionId, errorMessage, id]);
  return result.rows[0];
}

/**
 * List usage events with filters
 */
async function listUsageEvents({
  tenantId,
  userId,
  featureKey,
  status,
  fromDate,
  toDate,
  limit = 100,
  offset = 0
}) {
  let sql = `
    SELECT ue.*, u.email as user_email
    FROM billing_usage_events ue
    LEFT JOIN users u ON ue.user_id = u.id
    WHERE ue.tenant_id = $1
  `;
  
  const params = [tenantId];
  let paramIndex = 2;
  
  if (userId) {
    sql += ` AND ue.user_id = $${paramIndex++}`;
    params.push(userId);
  }
  
  if (featureKey) {
    sql += ` AND ue.feature_key = $${paramIndex++}`;
    params.push(featureKey);
  }
  
  if (status) {
    sql += ` AND ue.status = $${paramIndex++}`;
    params.push(status);
  }
  
  if (fromDate) {
    sql += ` AND ue.created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND ue.created_at < $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += ` ORDER BY ue.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get usage aggregation summary
 */
async function getUsageAggregation({ tenantId, featureKey, fromDate, toDate }) {
  let sql = `
    SELECT 
      feature_key,
      status,
      COUNT(*) as event_count,
      SUM(total_quantity) as total_quantity,
      SUM(total_cost) as total_cost,
      currency
    FROM billing_usage_events
    WHERE tenant_id = $1
  `;
  
  const params = [tenantId];
  let paramIndex = 2;
  
  if (featureKey) {
    sql += ` AND feature_key = $${paramIndex++}`;
    params.push(featureKey);
  }
  
  if (fromDate) {
    sql += ` AND created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND created_at < $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += ` GROUP BY feature_key, status, currency ORDER BY feature_key, status`;
  
  const result = await query(sql, params);
  return result.rows;
}

// =============================================================================
// FEATURE ENTITLEMENTS
// =============================================================================

/**
 * Get feature entitlement for tenant
 */
async function getFeatureEntitlement(tenantId, featureKey) {
  const sql = `
    SELECT * FROM billing_feature_entitlements
    WHERE tenant_id = $1 AND feature_key = $2
  `;
  
  const result = await query(sql, [tenantId, featureKey]);
  return result.rows[0] || null;
}

/**
 * List all entitlements for tenant
 */
async function listFeatureEntitlements(tenantId) {
  const sql = `
    SELECT * FROM billing_feature_entitlements
    WHERE tenant_id = $1
    ORDER BY feature_key
  `;
  
  const result = await query(sql, [tenantId]);
  return result.rows;
}

// =============================================================================
// LEGACY CREDIT TABLES (user_credits, credit_transactions)
// =============================================================================

/**
 * Get legacy credit balance (user_credits)
 */
async function getLegacyCreditBalance(tenantId) {
  const schema = process.env.DB_SCHEMA || process.env.POSTGRES_SCHEMA || 'lad_dev';
  const sql = `
    SELECT COALESCE(uc.balance, 0) as balance
    FROM ${schema}.user_credits uc
    WHERE uc.tenant_id = $1 OR uc.user_id = $1
    LIMIT 1
  `;
  const result = await query(sql, [tenantId]);
  return result.rows.length > 0 ? parseFloat(result.rows[0].balance) : 0;
}

/**
 * List legacy credit transactions (credit_transactions)
 */
async function listLegacyCreditTransactions({
  tenantId,
  fromDate,
  toDate,
  limit = 1000,
  offset = 0
}) {
  const schema = process.env.DB_SCHEMA || process.env.POSTGRES_SCHEMA || 'lad_dev';
  let sql = `
    SELECT *
    FROM ${schema}.credit_transactions
    WHERE tenant_id = $1
  `;
  const params = [tenantId];
  let paramIndex = 2;

  if (fromDate) {
    sql += ` AND created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }

  if (toDate) {
    sql += ` AND created_at < $${paramIndex++}`;
    params.push(toDate);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

module.exports = {
  // Pricing
  resolvePrice,
  listPricing,
  
  // Wallets
  getOrCreateWallet,
  updateWalletBalance,
  checkSufficientBalance,
  
  // Ledger
  createLedgerTransaction,
  getLedgerByIdempotencyKey,
  listLedgerTransactions,
  
  // Usage Events
  createUsageEvent,
  getUsageByIdempotencyKey,
  getUsageEventById,
  updateUsageEventStatus,
  listUsageEvents,
  getUsageAggregation,
  
  // Entitlements
  getFeatureEntitlement,
  listFeatureEntitlements,

  // Legacy credits
  getLegacyCreditBalance,
  listLegacyCreditTransactions
};
