const { pool } = require('../../../shared/database/connection');
const billingRepo = require('../repositories/billingRepo');
const { v4: uuidv4 } = require('uuid');

/**
 * Core Billing Service
 * Handles all credit operations, pricing resolution, and usage charging
 * All operations are atomic and tenant-scoped
 */

class BillingService {
  /**
   * Resolve price for a specific usage component
   * Supports tenant overrides and wildcard fallbacks
   * 
   * @param {Object} params
   * @returns {Promise<Object>} { unitPrice, priceId, description, ... }
   */
  async resolvePrice({ tenantId, category, provider, model, unit, atTime }) {
    const price = await billingRepo.resolvePrice({
      tenantId,
      category,
      provider,
      model,
      unit,
      atTime: atTime || new Date()
    });
    
    if (!price) {
      throw new Error(
        `No pricing found for ${category}/${provider}/${model}/${unit} for tenant ${tenantId}`
      );
    }
    
    return {
      priceId: price.id,
      unitPrice: parseFloat(price.unit_price),
      category: price.category,
      provider: price.provider,
      model: price.model,
      unit: price.unit,
      description: price.description,
      metadata: price.metadata,
      isTenantOverride: price.tenant_id !== null
    };
  }

  /**
   * Quote cost for usage items without charging
   * 
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {Array} params.items - [{category, provider, model, unit, quantity}]
   * @returns {Promise<Object>} { items: [...], totalCost, currency }
   */
  async quote({ tenantId, items }) {
    const quotedItems = [];
    let totalCost = 0;
    
    for (const item of items) {
      const price = await this.resolvePrice({
        tenantId,
        category: item.category,
        provider: item.provider,
        model: item.model,
        unit: item.unit,
        atTime: item.atTime
      });
      
      const quantity = parseFloat(item.quantity);
      const cost = quantity * price.unitPrice;
      
      quotedItems.push({
        ...item,
        quantity,
        unitPrice: price.unitPrice,
        cost: parseFloat(cost.toFixed(6)),
        priceId: price.priceId,
        description: item.description || price.description
      });
      
      totalCost += cost;
    }
    
    return {
      items: quotedItems,
      totalCost: parseFloat(totalCost.toFixed(6)),
      currency: 'USD'
    };
  }

  /**
   * Create usage event (idempotent)
   * Does not charge immediately - use chargeUsageEvent() after creation
   * 
   * @param {Object} params
   * @returns {Promise<Object>} Usage event record
   */
  async createUsageEvent({
    tenantId,
    userId = null,
    featureKey,
    items,
    idempotencyKey,
    externalReferenceId = null,
    metadata = {}
  }) {
    // Check if already exists (idempotency)
    const existing = await billingRepo.getUsageByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      console.log(`[Billing] Usage event already exists: ${idempotencyKey}`);
      return existing;
    }
    
    // Quote to get costs
    const quote = await this.quote({ tenantId, items });
    
    // Calculate totals
    const totalQuantity = items.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
    
    // Create usage event
    const usageEvent = await billingRepo.createUsageEvent({
      tenantId,
      userId,
      featureKey,
      usageItems: quote.items,
      totalQuantity,
      totalCost: quote.totalCost,
      currency: quote.currency,
      idempotencyKey,
      externalReferenceId,
      metadata
    });
    
    console.log(`[Billing] Created usage event ${usageEvent.id}: ${featureKey} - $${quote.totalCost}`);
    
    return usageEvent;
  }

  /**
   * Charge a usage event (debit wallet atomically)
   * Idempotent - if already charged, returns existing ledger transaction
   * 
   * @param {Object} params
   * @param {string} params.usageEventId - Usage event UUID
   * @param {string} params.tenantId - Tenant UUID
   * @returns {Promise<Object>} Ledger transaction
   */
  async chargeUsageEvent({ usageEventId, tenantId }) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get usage event
      const usageEvent = await billingRepo.getUsageEventById(usageEventId, tenantId);
      if (!usageEvent) {
        throw new Error(`Usage event not found: ${usageEventId}`);
      }
      
      // Check if already charged (idempotency)
      if (usageEvent.status === 'charged') {
        await client.query('COMMIT');
        console.log(`[Billing] Usage event already charged: ${usageEventId}`);
        return { alreadyCharged: true, ledgerTransactionId: usageEvent.ledger_transaction_id };
      }
      
      if (usageEvent.status === 'voided') {
        throw new Error(`Cannot charge voided usage event: ${usageEventId}`);
      }
      
      // Debit wallet atomically
      const ledgerTx = await this.debitWalletAtomic({
        tenantId,
        amount: usageEvent.total_cost,
        referenceType: 'usage_event',
        referenceId: usageEventId,
        idempotencyKey: `charge_usage_${usageEventId}`,
        description: `Charge for ${usageEvent.feature_key}`,
        metadata: {
          featureKey: usageEvent.feature_key,
          externalRef: usageEvent.external_reference_id
        },
        client
      });
      
      // Mark usage event as charged
      await billingRepo.updateUsageEventStatus({
        id: usageEventId,
        status: 'charged',
        ledgerTransactionId: ledgerTx.id,
        errorMessage: null,
        client
      });
      
      await client.query('COMMIT');
      
      console.log(`[Billing] Charged usage event ${usageEventId}: $${usageEvent.total_cost}`);
      
      return ledgerTx;
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Mark usage event as failed
      try {
        await billingRepo.updateUsageEventStatus({
          id: usageEventId,
          status: 'failed',
          ledgerTransactionId: null,
          errorMessage: error.message,
          client: null
        });
      } catch (updateError) {
        console.error('[Billing] Failed to update usage event status:', updateError);
      }
      
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Charge usage event by idempotency key (convenience method)
   */
  async chargeByIdempotencyKey({ tenantId, idempotencyKey }) {
    const usageEvent = await billingRepo.getUsageByIdempotencyKey(tenantId, idempotencyKey);
    if (!usageEvent) {
      throw new Error(`Usage event not found with idempotency key: ${idempotencyKey}`);
    }
    
    return this.chargeUsageEvent({ usageEventId: usageEvent.id, tenantId });
  }

  /**
   * Debit wallet (atomic transaction with ledger)
   * 
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {number} params.amount - Amount to debit (positive number)
   * @param {string} params.referenceType - e.g., 'usage_event', 'invoice'
   * @param {string} params.referenceId - UUID of reference entity
   * @param {string} params.idempotencyKey - Unique key for idempotency
   * @param {string} params.description
   * @param {Object} params.metadata
   * @param {Object} params.client - DB client (must be in transaction)
   * @returns {Promise<Object>} Ledger transaction
   */
  async debitWalletAtomic({
    tenantId,
    amount,
    referenceType,
    referenceId,
    idempotencyKey,
    description,
    metadata = {},
    createdBy = null,
    client = null
  }) {
    const shouldManageTransaction = !client;
    let managedClient;
    
    if (shouldManageTransaction) {
      // Using pool from module
      managedClient = await pool.connect();
      client = managedClient;
      await client.query('BEGIN');
    }
    
    try {
      // Check idempotency
      const existing = await billingRepo.getLedgerByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        if (shouldManageTransaction) await client.query('COMMIT');
        console.log(`[Billing] Debit already processed: ${idempotencyKey}`);
        return existing;
      }
      
      // Get wallet with lock
      const walletQuery = `
        SELECT * FROM billing_wallets
        WHERE tenant_id = $1 AND user_id IS NULL
        FOR UPDATE
      `;
      const walletResult = await client.query(walletQuery, [tenantId]);
      
      if (walletResult.rows.length === 0) {
        throw new Error(`Wallet not found for tenant ${tenantId}`);
      }
      
      const wallet = walletResult.rows[0];
      const balanceBefore = parseFloat(wallet.current_balance);
      const debitAmount = parseFloat(amount);
      const balanceAfter = balanceBefore - debitAmount;
      
      // Check sufficient balance
      if (balanceAfter < 0) {
        throw new Error(
          `Insufficient balance. Required: ${debitAmount}, Available: ${balanceBefore}`
        );
      }
      
      // Update wallet balance
      await client.query(
        'UPDATE billing_wallets SET current_balance = $1, updated_at = NOW() WHERE id = $2',
        [balanceAfter, wallet.id]
      );
      
      // Create ledger transaction
      const ledgerTx = await billingRepo.createLedgerTransaction({
        tenantId,
        walletId: wallet.id,
        transactionType: 'debit',
        amount: -debitAmount, // Negative for debit
        balanceBefore,
        balanceAfter,
        referenceType,
        referenceId,
        idempotencyKey,
        createdBy,
        description,
        metadata,
        client
      });
      
      if (shouldManageTransaction) await client.query('COMMIT');
      
      console.log(`[Billing] Debited $${debitAmount} from tenant ${tenantId}. New balance: $${balanceAfter}`);
      
      return ledgerTx;
      
    } catch (error) {
      if (shouldManageTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (managedClient) managedClient.release();
    }
  }

  /**
   * Credit wallet (atomic transaction with ledger)
   * 
   * @param {Object} params - Same as debitWalletAtomic
   * @returns {Promise<Object>} Ledger transaction
   */
  async creditWalletAtomic({
    tenantId,
    amount,
    referenceType,
    referenceId,
    idempotencyKey,
    description,
    metadata = {},
    createdBy = null,
    client = null
  }) {
    const shouldManageTransaction = !client;
    let managedClient;
    
    if (shouldManageTransaction) {
      managedClient = await pool.connect();
      client = managedClient;
      await client.query('BEGIN');
    }
    
    try {
      // Check idempotency
      const existing = await billingRepo.getLedgerByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        if (shouldManageTransaction) await client.query('COMMIT');
        console.log(`[Billing] Credit already processed: ${idempotencyKey}`);
        return existing;
      }
      
      // Get wallet with lock - prefer tenant-level (user_id IS NULL) but accept user-level too
      const walletQuery = `
        SELECT * FROM billing_wallets
        WHERE tenant_id = $1
        ORDER BY user_id NULLS FIRST
        LIMIT 1
        FOR UPDATE
      `;
      const walletResult = await client.query(walletQuery, [tenantId]);
      
      console.log(`[Billing] Wallet lookup for tenant ${tenantId}: found ${walletResult.rows.length} rows`);
      
      let wallet;
      if (walletResult.rows.length === 0) {
        // Create wallet if doesn't exist - explicitly set user_id to NULL
        console.log(`[Billing] Creating new wallet for tenant ${tenantId}`);
        const createResult = await client.query(
          `INSERT INTO billing_wallets (tenant_id, user_id, current_balance, currency, status)
           VALUES ($1, NULL, 0, 'USD', 'active')
           RETURNING *`,
          [tenantId]
        );
        wallet = createResult.rows[0];
        console.log(`[Billing] Created wallet with id ${wallet.id} for tenant ${tenantId}`);
      } else {
        wallet = walletResult.rows[0];
        console.log(`[Billing] Using existing wallet with id ${wallet.id}, balance ${wallet.current_balance}`);
      }
      
      const balanceBefore = parseFloat(wallet.current_balance);
      const creditAmount = parseFloat(amount);
      const balanceAfter = balanceBefore + creditAmount;
      
      // Update wallet balance
      await client.query(
        'UPDATE billing_wallets SET current_balance = $1, updated_at = NOW() WHERE id = $2',
        [balanceAfter, wallet.id]
      );
      
      // Create ledger transaction
      const ledgerTx = await billingRepo.createLedgerTransaction({
        tenantId,
        walletId: wallet.id,
        transactionType: referenceType === 'manual' ? 'topup' : 'credit',
        amount: creditAmount, // Positive for credit
        balanceBefore,
        balanceAfter,
        referenceType,
        referenceId,
        idempotencyKey,
        createdBy,
        description,
        metadata,
        client
      });
      
      if (shouldManageTransaction) await client.query('COMMIT');
      
      console.log(`[Billing] Credited $${creditAmount} to tenant ${tenantId}. New balance: $${balanceAfter}`);
      
      return ledgerTx;
      
    } catch (error) {
      if (shouldManageTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (managedClient) managedClient.release();
    }
  }

  /**
   * Get wallet balance for tenant
   */
  async getWalletBalance(tenantId) {
    console.log(`[Billing] getWalletBalance called for tenant: ${tenantId}`);
    const wallet = await billingRepo.getOrCreateWallet(tenantId);
    console.log(`[Billing] Wallet retrieved:`, { 
      id: wallet.id, 
      tenantId: wallet.tenant_id, 
      balance: wallet.current_balance,
      reserved: wallet.reserved_balance
    });
    
    const currentBalance = parseFloat(wallet.current_balance) || 0;
    const reservedBalance = parseFloat(wallet.reserved_balance) || 0;
    
    return {
      walletId: wallet.id,
      tenantId: wallet.tenant_id,
      currentBalance: currentBalance,
      reservedBalance: reservedBalance,
      availableBalance: currentBalance - reservedBalance,
      currency: wallet.currency || 'USD',
      status: wallet.status || 'active',
      lowBalanceThreshold: wallet.low_balance_threshold ? parseFloat(wallet.low_balance_threshold) : null
    };
  }

  /**
   * List usage events with optional filters
   */
  async listUsageEvents(filters) {
    return billingRepo.listUsageEvents(filters);
  }

  /**
   * Get usage aggregation summary
   */
  async getUsageAggregation(filters) {
    return billingRepo.getUsageAggregation(filters);
  }

  /**
   * List ledger transactions
   */
  async listLedgerTransactions(filters) {
    return billingRepo.listLedgerTransactions(filters);
  }

  /**
   * Legacy: get credit balance from user_credits
   */
  async getLegacyCreditBalance(tenantId) {
    return billingRepo.getLegacyCreditBalance(tenantId);
  }

  /**
   * Legacy: list credit transactions from credit_transactions
   */
  async listLegacyCreditTransactions(filters) {
    return billingRepo.listLegacyCreditTransactions(filters);
  }

  /**
   * List active pricing
   */
  async listPricing(filters) {
    return billingRepo.listPricing(filters);
  }

  /**
   * Create usage event and charge immediately (convenience method)
   * Useful for synchronous operations where you want to charge right away
   * 
   * @returns {Promise<Object>} { usageEvent, ledgerTransaction }
   */
  async createAndChargeUsageEvent(params) {
    const usageEvent = await this.createUsageEvent(params);
    const ledgerTx = await this.chargeUsageEvent({
      usageEventId: usageEvent.id,
      tenantId: params.tenantId
    });
    
    return { usageEvent, ledgerTransaction: ledgerTx };
  }
}

module.exports = new BillingService();
