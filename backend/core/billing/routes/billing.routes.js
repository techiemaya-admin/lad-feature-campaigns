const express = require('express');
const router = express.Router();
const billingService = require('../services/billingService');
const { authenticateToken } = require('../../middleware/auth');

/**
 * Billing API Routes
 * All routes are tenant-scoped and require authentication
 */

// =============================================================================
// MIDDLEWARE: Extract tenant from JWT
// =============================================================================
const requireTenantContext = (req, res, next) => {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({
      success: false,
      error: 'No tenant context found. User must be associated with a tenant.'
    });
  }
  req.tenantId = req.user.tenantId;
  next();
};

// =============================================================================
// MIDDLEWARE: Check billing permissions
// =============================================================================
const requireBillingAdmin = (req, res, next) => {
  const capabilities = req.user?.capabilities || [];
  const role = req.user?.role;
  
  // Owner or billing.admin capability
  if (role === 'owner' || capabilities.includes('billing.admin')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    error: 'Billing admin permission required'
  });
};

const requireBillingView = (req, res, next) => {
  const capabilities = req.user?.capabilities || [];
  const role = req.user?.role;
  
  // Owner, admin, member, or billing.view capability can view wallet
  // All authenticated users should be able to see their own credits
  if (['owner', 'admin', 'member'].includes(role) || 
      capabilities.includes('billing.admin') || 
      capabilities.includes('billing.view')) {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    error: 'Billing view permission required'
  });
};

// Apply authentication and tenant context to all routes
router.use(authenticateToken);
router.use(requireTenantContext);

// =============================================================================
// GET /api/billing/pricing
// Get active pricing catalog (tenant-aware)
// =============================================================================
router.get('/pricing', async (req, res) => {
  try {
    const { category, provider, model, unit } = req.query;
    
    // If specific lookup requested
    if (category && provider && unit) {
      const price = await billingService.resolvePrice({
        tenantId: req.tenantId,
        category,
        provider,
        model: model || '*',
        unit
      });
      
      return res.json({
        success: true,
        price
      });
    }
    
    // List all pricing
    const prices = await billingService.listPricing({
      tenantId: req.tenantId,
      category,
      provider
    });
    
    res.json({
      success: true,
      prices,
      count: prices.length
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching pricing:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /api/billing/quote
// Get cost estimate without charging
// =============================================================================
router.post('/quote', async (req, res) => {
  try {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required'
      });
    }
    
    // Validate items
    for (const item of items) {
      if (!item.category || !item.provider || !item.unit || item.quantity === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have category, provider, unit, and quantity'
        });
      }
    }
    
    const quote = await billingService.quote({
      tenantId: req.tenantId,
      items
    });
    
    res.json({
      success: true,
      quote
    });
    
  } catch (error) {
    console.error('[Billing API] Error generating quote:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /api/billing/wallet
// Get wallet balance and info
// =============================================================================
router.get('/wallet', requireBillingView, async (req, res) => {
  try {
    console.log('[Billing API] /wallet called with tenantId:', req.tenantId);
    const wallet = await billingService.getWalletBalance(req.tenantId);
    console.log('[Billing API] Wallet result:', JSON.stringify(wallet));
    
    res.json({
      success: true,
      wallet
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /api/billing/topup
// Add credits to wallet (admin only)
// =============================================================================
router.post('/topup', requireBillingAdmin, async (req, res) => {
  try {
    const { amount, description, metadata } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }
    
    const ledgerTx = await billingService.creditWalletAtomic({
      tenantId: req.tenantId,
      amount: parseFloat(amount),
      referenceType: 'manual',
      referenceId: null,
      idempotencyKey: `topup_${req.tenantId}_${Date.now()}_${Math.random()}`,
      description: description || `Manual credit top-up by ${req.user.email}`,
      metadata: metadata || {},
      createdBy: req.user.userId
    });
    
    // Get updated wallet
    const wallet = await billingService.getWalletBalance(req.tenantId);
    
    res.json({
      success: true,
      transaction: ledgerTx,
      wallet
    });
    
  } catch (error) {
    console.error('[Billing API] Error topping up wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /api/billing/charge
// Create usage event and charge (idempotent)
// =============================================================================
router.post('/charge', async (req, res) => {
  try {
    const {
      featureKey,
      items,
      idempotencyKey,
      externalReferenceId,
      metadata,
      chargeImmediately = true
    } = req.body;
    
    if (!featureKey || !items || !Array.isArray(items) || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: 'featureKey, items array, and idempotencyKey are required'
      });
    }
    
    // Validate items
    for (const item of items) {
      if (!item.category || !item.provider || !item.unit || item.quantity === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have category, provider, unit, and quantity'
        });
      }
    }
    
    if (chargeImmediately) {
      // Create and charge in one go
      const result = await billingService.createAndChargeUsageEvent({
        tenantId: req.tenantId,
        userId: req.user.userId,
        featureKey,
        items,
        idempotencyKey,
        externalReferenceId,
        metadata
      });
      
      res.json({
        success: true,
        usageEvent: result.usageEvent,
        ledgerTransaction: result.ledgerTransaction
      });
    } else {
      // Create only (charge later)
      const usageEvent = await billingService.createUsageEvent({
        tenantId: req.tenantId,
        userId: req.user.userId,
        featureKey,
        items,
        idempotencyKey,
        externalReferenceId,
        metadata
      });
      
      res.json({
        success: true,
        usageEvent,
        message: 'Usage event created. Call POST /api/billing/charge/:usageEventId to charge.'
      });
    }
    
  } catch (error) {
    console.error('[Billing API] Error charging:', error);
    res.status(error.message.includes('Insufficient balance') ? 402 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /api/billing/charge/:usageEventId
// Charge a specific usage event
// =============================================================================
router.post('/charge/:usageEventId', async (req, res) => {
  try {
    const { usageEventId } = req.params;
    
    const ledgerTx = await billingService.chargeUsageEvent({
      usageEventId,
      tenantId: req.tenantId
    });
    
    res.json({
      success: true,
      ledgerTransaction: ledgerTx
    });
    
  } catch (error) {
    console.error('[Billing API] Error charging usage event:', error);
    res.status(error.message.includes('Insufficient balance') ? 402 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /api/billing/usage
// List usage events with filters
// =============================================================================
router.get('/usage', requireBillingView, async (req, res) => {
  try {
    const {
      featureKey,
      status,
      fromDate,
      toDate,
      limit = 100,
      offset = 0,
      aggregate = false
    } = req.query;
    
    if (aggregate === 'true' || aggregate === true) {
      // Return aggregated summary
      const summary = await billingService.getUsageAggregation({
        tenantId: req.tenantId,
        featureKey,
        fromDate: fromDate ? new Date(fromDate) : undefined,
        toDate: toDate ? new Date(toDate) : undefined
      });
      
      return res.json({
        success: true,
        summary,
        aggregated: true
      });
    }
    
    // Return detailed list
    const events = await billingService.listUsageEvents({
      tenantId: req.tenantId,
      featureKey,
      status,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      events,
      count: events.length,
      filters: { featureKey, status, fromDate, toDate },
      pagination: { limit: parseInt(limit), offset: parseInt(offset) }
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching usage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// GET /api/billing/transactions
// List ledger transactions
// =============================================================================
router.get('/transactions', requireBillingView, async (req, res) => {
  try {
    const { fromDate, toDate, limit = 100, offset = 0 } = req.query;
    
    const transactions = await billingService.listLedgerTransactions({
      tenantId: req.tenantId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      transactions,
      count: transactions.length,
      pagination: { limit: parseInt(limit), offset: parseInt(offset) }
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// POST /api/billing/webhooks/stripe
// Stripe webhook handler (stub for future implementation)
// =============================================================================
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // TODO: Implement Stripe webhook verification
    // const sig = req.headers['stripe-signature'];
    // const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    
    console.log('[Billing] Stripe webhook received (not yet implemented)');
    
    res.json({ received: true });
    
  } catch (error) {
    console.error('[Billing API] Stripe webhook error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// LEGACY COMPATIBILITY ROUTES
// Support old /api/wallet/* endpoints for backward compatibility
// =============================================================================

/**
 * GET /api/wallet/balance
 * Legacy endpoint - redirects to /api/billing/wallet with transformed response
 */
router.get('/wallet/balance', authenticateToken, requireTenantContext, async (req, res) => {
  try {
    const wallet = await billingService.getWalletBalance(req.tenantId);
    const legacyBalance = await billingService.getLegacyCreditBalance(req.tenantId);
    const useLegacyBalance = wallet.currentBalance <= 0 && legacyBalance > 0;
    const effectiveBalance = useLegacyBalance ? legacyBalance : wallet.currentBalance;
    const effectiveCurrency = useLegacyBalance ? 'CREDITS' : wallet.currency;
    
    // Get monthly usage
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const usage = await billingService.listUsageEvents({
      tenantId: req.tenantId,
      fromDate: firstDayOfMonth,
      toDate: now,
      status: 'charged'
    });
    
    let monthlyUsage = usage.reduce((sum, event) => sum + parseFloat(event.total_cost), 0);
    if (monthlyUsage === 0) {
      const legacyMonthlyTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        fromDate: firstDayOfMonth,
        toDate: now,
        limit: 5000
      });
      monthlyUsage = legacyMonthlyTx
        .map(tx => parseFloat(tx.amount))
        .filter(amount => amount < 0)
        .reduce((sum, amount) => sum + Math.abs(amount), 0);
    }
    
    // Get last topup
    const transactions = await billingService.listLedgerTransactions({
      tenantId: req.tenantId,
      limit: 100
    });
    
    const lastTopup = transactions.find(tx => tx.transaction_type === 'topup');
    let totalSpent = transactions
      .filter(tx => tx.transaction_type === 'debit')
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);
    if (totalSpent === 0) {
      const legacyAllTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        limit: 5000
      });
      totalSpent = legacyAllTx
        .map(tx => parseFloat(tx.amount))
        .filter(amount => amount < 0)
        .reduce((sum, amount) => sum + Math.abs(amount), 0);
    }
    
    // Transform to legacy format
    res.json({
      success: true,
      credits: effectiveBalance,
      balance: effectiveBalance,
      currency: effectiveCurrency,
      lastRecharge: lastTopup ? {
        amount: parseFloat(lastTopup.amount),
        credits: parseFloat(lastTopup.amount),
        date: lastTopup.created_at
      } : null,
      monthlyUsage: monthlyUsage,
      totalSpent: totalSpent,
      transactions: (transactions.length > 0 ? transactions : await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        limit: 10
      })).slice(0, 10).map(tx => ({
        id: tx.id,
        amount: parseFloat(tx.amount),
        type: (tx.transaction_type ? tx.transaction_type === 'debit' : parseFloat(tx.amount) < 0) ? 'debit' : 'credit',
        description: tx.description,
        timestamp: tx.created_at,
        status: 'completed'
      }))
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching wallet balance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      // Return zero balance on error for graceful degradation
      credits: 0,
      balance: 0,
      currency: 'USD',
      lastRecharge: null,
      monthlyUsage: 0,
      totalSpent: 0,
      transactions: []
    });
  }
});

/**
 * GET /api/wallet/usage/analytics
 * Legacy endpoint - returns usage analytics for the specified time range
 */
router.get('/wallet/usage/analytics', authenticateToken, requireTenantContext, async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Parse time range
    const now = new Date();
    let fromDate;
    
    switch (timeRange) {
      case '7d':
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    // Get usage events
    const usageEvents = await billingService.listUsageEvents({
      tenantId: req.tenantId,
      fromDate,
      toDate: now,
      status: 'charged'
    });

    let legacyTx = [];
    if (usageEvents.length === 0) {
      legacyTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        fromDate,
        toDate: now,
        limit: 5000
      });
    }
    
    // Calculate daily breakdown + feature usage
    const dailyUsage = {};
    const featureUsage = {};

    if (usageEvents.length > 0) {
      usageEvents.forEach(event => {
        const date = new Date(event.created_at).toISOString().split('T')[0];
        if (!dailyUsage[date]) {
          dailyUsage[date] = 0;
        }
        dailyUsage[date] += parseFloat(event.total_cost);

        const feature = event.feature_key || 'unknown';
        if (!featureUsage[feature]) {
          featureUsage[feature] = { feature, totalCost: 0, count: 0 };
        }
        featureUsage[feature].totalCost += parseFloat(event.total_cost);
        featureUsage[feature].count += 1;
      });
    } else {
      legacyTx.forEach(tx => {
        const amount = parseFloat(tx.amount);
        if (amount >= 0) return;
        const date = new Date(tx.created_at).toISOString().split('T')[0];
        if (!dailyUsage[date]) {
          dailyUsage[date] = 0;
        }
        dailyUsage[date] += Math.abs(amount);

        const metaFeature = tx.metadata?.feature || tx.metadata?.featureKey;
        const metaUsage = tx.metadata?.usage_type || tx.metadata?.usageType;
        const feature = metaFeature || metaUsage || 'unknown';
        if (!featureUsage[feature]) {
          featureUsage[feature] = { feature, totalCost: 0, count: 0 };
        }
        featureUsage[feature].totalCost += Math.abs(amount);
        featureUsage[feature].count += 1;
      });
    }
    
    // Calculate totals and percentages
    const totalUsage = usageEvents.length > 0
      ? usageEvents.reduce((sum, e) => sum + parseFloat(e.total_cost), 0)
      : legacyTx.reduce((sum, tx) => {
          const amount = parseFloat(tx.amount);
          return amount < 0 ? sum + Math.abs(amount) : sum;
        }, 0);
    
    // Transform to frontend format
    res.json({
      success: true,
      totalCreditsUsed: totalUsage,
      topFeatures: Object.values(featureUsage)
        .sort((a, b) => b.totalCost - a.totalCost)
        .map(f => ({
          featureName: f.feature,
          totalCredits: f.totalCost,
          usageCount: f.count,
          percentage: totalUsage > 0 ? (f.totalCost / totalUsage) * 100 : 0,
          icon: f.feature // Frontend will map this to appropriate icon
        })),
      dailyUsage: Object.entries(dailyUsage)
        .map(([date, cost]) => ({
          date,
          credits: cost
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date)),
      monthlyTrend: {
        currentMonth: totalUsage,
        lastMonth: 0, // TODO: Calculate from previous period
        percentageChange: 0
      }
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching usage analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      // Return empty analytics on error for graceful degradation
      summary: {
        totalSpent: 0,
        totalTopup: 0,
        netChange: 0,
        transactionCount: 0,
        averageDailySpend: 0
      },
      byFeature: [],
      dailyUsage: {},
      transactions: []
    });
  }
});

/**
 * GET /api/wallet/packages
 * Legacy endpoint - returns credit packages (stub for now)
 */
router.get('/wallet/packages', async (req, res) => {
  try {
    // Return standard credit packages
    const packages = [
      {
        id: 'starter',
        name: 'Starter',
        credits: 1000,
        price: 99,
        pricePerCredit: 0.099,
        savings: 0,
        description: 'Get started with essentials'
      },
      {
        id: 'professional',
        name: 'Professional',
        credits: 3000,
        price: 199,
        pricePerCredit: 0.0663,
        savings: 33,
        popular: true,
        description: 'For small teams'
      },
      {
        id: 'business',
        name: 'Business',
        credits: 12000,
        price: 499,
        pricePerCredit: 0.0416,
        savings: 58,
        description: 'For growing businesses'
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        credits: 12000,
        price: 999,
        pricePerCredit: 0.0833,
        savings: 0,
        description: 'Custom solutions (Contact sales for Enterprise options)'
      }
    ];
    
    res.json({
      success: true,
      packages
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching packages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// ALTERNATE ROUTES (without /wallet prefix for direct mounting on /api/wallet)
// =============================================================================

/**
 * GET /api/wallet/balance (when router mounted on /api/wallet)
 * Same as /wallet/balance but accessible at /api/wallet/balance
 */
router.get('/balance', authenticateToken, requireTenantContext, async (req, res) => {
  try {
    const wallet = await billingService.getWalletBalance(req.tenantId);
    const legacyBalance = await billingService.getLegacyCreditBalance(req.tenantId);
    const useLegacyBalance = wallet.currentBalance <= 0 && legacyBalance > 0;
    const effectiveBalance = useLegacyBalance ? legacyBalance : wallet.currentBalance;
    const effectiveCurrency = useLegacyBalance ? 'CREDITS' : wallet.currency;
    
    // Get monthly usage
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const usage = await billingService.listUsageEvents({
      tenantId: req.tenantId,
      fromDate: firstDayOfMonth,
      toDate: now,
      status: 'charged'
    });
    
    let monthlyUsage = usage.reduce((sum, event) => sum + parseFloat(event.total_cost), 0);
    if (monthlyUsage === 0) {
      const legacyMonthlyTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        fromDate: firstDayOfMonth,
        toDate: now,
        limit: 5000
      });
      monthlyUsage = legacyMonthlyTx
        .map(tx => parseFloat(tx.amount))
        .filter(amount => amount < 0)
        .reduce((sum, amount) => sum + Math.abs(amount), 0);
    }
    
    // Get last topup
    const transactions = await billingService.listLedgerTransactions({
      tenantId: req.tenantId,
      limit: 100
    });
    
    const lastTopup = transactions.find(tx => tx.transaction_type === 'topup');
    let totalSpent = transactions
      .filter(tx => tx.transaction_type === 'debit')
      .reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);
    if (totalSpent === 0) {
      const legacyAllTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        limit: 5000
      });
      totalSpent = legacyAllTx
        .map(tx => parseFloat(tx.amount))
        .filter(amount => amount < 0)
        .reduce((sum, amount) => sum + Math.abs(amount), 0);
    }
    
    // Transform to legacy format
    res.json({
      success: true,
      credits: effectiveBalance,
      balance: effectiveBalance,
      currency: effectiveCurrency,
      lastRecharge: lastTopup ? {
        amount: parseFloat(lastTopup.amount),
        credits: parseFloat(lastTopup.amount),
        date: lastTopup.created_at
      } : null,
      monthlyUsage: monthlyUsage,
      totalSpent: totalSpent,
      transactions: (transactions.length > 0 ? transactions : await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        limit: 10
      })).slice(0, 10).map(tx => ({
        id: tx.id,
        amount: parseFloat(tx.amount),
        type: (tx.transaction_type ? tx.transaction_type === 'debit' : parseFloat(tx.amount) < 0) ? 'debit' : 'credit',
        description: tx.description,
        timestamp: tx.created_at,
        status: 'completed'
      }))
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching wallet balance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      credits: 0,
      balance: 0,
      currency: 'USD',
      lastRecharge: null,
      monthlyUsage: 0,
      totalSpent: 0,
      transactions: []
    });
  }
});

/**
 * GET /api/wallet/usage/analytics (when router mounted on /api/wallet)
 * Same as /wallet/usage/analytics but accessible at /api/wallet/usage/analytics
 */
router.get('/usage/analytics', authenticateToken, requireTenantContext, async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Parse time range
    const now = new Date();
    let fromDate;
    
    switch (timeRange) {
      case '7d':
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    // Get usage events
    const usageEvents = await billingService.listUsageEvents({
      tenantId: req.tenantId,
      fromDate,
      toDate: now,
      status: 'charged'
    });
    
    // If no usage events, fallback to legacy credit transactions
    let legacyTx = [];
    if (usageEvents.length === 0) {
      legacyTx = await billingService.listLegacyCreditTransactions({
        tenantId: req.tenantId,
        fromDate,
        toDate: now,
        limit: 5000
      });
    }
    
    // Calculate daily and feature breakdown
    const dailyUsage = {};
    const featureUsage = {};
    
    if (usageEvents.length > 0) {
      // Use new billing system data
      usageEvents.forEach(event => {
        const date = new Date(event.created_at).toISOString().split('T')[0];
        if (!dailyUsage[date]) {
          dailyUsage[date] = 0;
        }
        dailyUsage[date] += parseFloat(event.total_cost);
        
        const feature = event.feature_key || 'unknown';
        if (!featureUsage[feature]) {
          featureUsage[feature] = { feature, totalCost: 0, count: 0 };
        }
        featureUsage[feature].totalCost += parseFloat(event.total_cost);
        featureUsage[feature].count += 1;
      });
    } else {
      // Use legacy credit transactions
      legacyTx.forEach(tx => {
        const amount = parseFloat(tx.amount);
        if (amount >= 0) return; // Skip credits, only process debits
        
        const date = new Date(tx.created_at).toISOString().split('T')[0];
        if (!dailyUsage[date]) {
          dailyUsage[date] = 0;
        }
        dailyUsage[date] += Math.abs(amount);
        
        // Extract feature from metadata
        const metaFeature = tx.metadata?.feature || tx.metadata?.featureKey;
        const metaUsage = tx.metadata?.usage_type || tx.metadata?.usageType;
        const feature = metaFeature || metaUsage || 'unknown';
        
        if (!featureUsage[feature]) {
          featureUsage[feature] = { feature, totalCost: 0, count: 0 };
        }
        featureUsage[feature].totalCost += Math.abs(amount);
        featureUsage[feature].count += 1;
      });
    }
    
    // Calculate totals and percentages
    const totalUsage = usageEvents.length > 0
      ? usageEvents.reduce((sum, e) => sum + parseFloat(e.total_cost), 0)
      : legacyTx.reduce((sum, tx) => {
          const amount = parseFloat(tx.amount);
          return amount < 0 ? sum + Math.abs(amount) : sum;
        }, 0);
    
    // Transform to frontend format
    res.json({
      success: true,
      totalCreditsUsed: totalUsage,
      topFeatures: Object.values(featureUsage)
        .sort((a, b) => b.totalCost - a.totalCost)
        .map(f => ({
          featureName: f.feature,
          totalCredits: f.totalCost,
          usageCount: f.count,
          percentage: totalUsage > 0 ? (f.totalCost / totalUsage) * 100 : 0,
          icon: f.feature // Frontend will map this to appropriate icon
        })),
      dailyUsage: Object.entries(dailyUsage)
        .map(([date, cost]) => ({
          date,
          credits: cost
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date)),
      monthlyTrend: {
        currentMonth: totalUsage,
        lastMonth: 0, // TODO: Calculate from previous period
        percentageChange: 0
      }
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching usage analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/wallet/packages (when router mounted on /api/wallet)
 * Same as /wallet/packages but accessible at /api/wallet/packages
 */
router.get('/packages', async (req, res) => {
  try {
    // Return standard credit packages
    const packages = [
      {
        id: 'starter',
        name: 'Starter',
        credits: 1000,
        price: 99,
        pricePerCredit: 0.099,
        savings: 0,
        description: 'Get started with essentials'
      },
      {
        id: 'professional',
        name: 'Professional',
        credits: 3000,
        price: 199,
        pricePerCredit: 0.0663,
        savings: 33,
        popular: true,
        description: 'For small teams'
      },
      {
        id: 'business',
        name: 'Business',
        credits: 12000,
        price: 499,
        pricePerCredit: 0.0416,
        savings: 58,
        description: 'For growing businesses'
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        credits: 12000,
        price: 999,
        pricePerCredit: 0.0833,
        savings: 0,
        description: 'Custom solutions (Contact sales for Enterprise options)'
      }
    ];
    
    res.json({
      success: true,
      packages
    });
    
  } catch (error) {
    console.error('[Billing API] Error fetching packages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
