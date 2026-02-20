/**
 * Stripe Integration Routes
 * Handles Stripe checkout and payment processing
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Initialize Stripe (lazy loading to avoid errors if key not set)
let stripe = null;
const getStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

// Credit pricing packages - must match billing.routes.js packages
const CREDIT_PACKAGES = {
  99: 1000,    // $99 = 1,000 credits
  199: 3000,   // $199 = 3,000 credits
  499: 12000,  // $499 = 12,000 credits
  999: 12000   // $999 = 12,000 credits
};

/**
 * Convert dollar amount to credits based on pricing tiers
 * For custom amounts, use closest tier's rate or calculate proportionally
 */
function convertDollarsToCredits(dollarAmount) {
  // Check if exact package match
  if (CREDIT_PACKAGES[dollarAmount]) {
    return CREDIT_PACKAGES[dollarAmount];
  }
  
  // For custom amounts, use tiered pricing
  if (dollarAmount >= 499) {
    // Business tier rate: $499 = 12,000 credits (0.0416/credit)
    return Math.round(dollarAmount * (12000 / 499));
  } else if (dollarAmount >= 199) {
    // Professional tier rate: $199 = 3,000 credits (0.0663/credit)
    return Math.round(dollarAmount * (3000 / 199));
  } else if (dollarAmount >= 99) {
    // Starter tier rate: $99 = 1,000 credits (0.099/credit)
    return Math.round(dollarAmount * (1000 / 99));
  } else {
    // Below $99, use starter rate
    return Math.round(dollarAmount * (1000 / 99));
  }
}

/**
 * POST /api/stripe/create-credits-checkout
 * Create a Stripe Checkout session for purchasing credits
 */
router.post('/create-credits-checkout', authenticateToken, async (req, res) => {
  try {
    const { amount, successUrl, cancelUrl, metadata } = req.body;
    const tenantId = req.user?.tenantId;
    const userId = req.user?.userId || req.user?.id;

    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be greater than 0.'
      });
    }

    if (!tenantId) {
      return res.status(403).json({
        success: false,
        error: 'No tenant context found'
      });
    }

    // Check if Stripe is configured
    const stripeClient = getStripe();
    if (!stripeClient) {
      logger.warn('[Stripe] Stripe not configured - STRIPE_SECRET_KEY missing');
      return res.status(501).json({
        success: false,
        error: 'Payment processing not configured. Please contact support.',
        code: 'STRIPE_NOT_CONFIGURED'
      });
    }

    // Convert dollar amount to actual credits
    const creditsToAdd = convertDollarsToCredits(amount);
    
    // Calculate fees (UAE Stripe pricing)
    const VAT_RATE = 0.05; // 5% VAT
    const STRIPE_PERCENTAGE = 0.029; // 2.9%
    const STRIPE_FIXED = 1.00; // AED 1.00 (or equivalent in transaction currency)
    
    // Calculate total with VAT and Stripe fees
    // Formula: (baseAmount + VAT) / (1 - stripeFeePercent) + stripeFeeFixed
    const amountWithVAT = amount * (1 + VAT_RATE);
    const totalAmount = (amountWithVAT / (1 - STRIPE_PERCENTAGE)) + STRIPE_FIXED;
    const vatAmount = amount * VAT_RATE;
    const stripeFee = totalAmount - amountWithVAT;
    
    logger.info('[Stripe] Creating checkout session', {
      baseAmount: amount,
      vatAmount: vatAmount.toFixed(2),
      stripeFee: stripeFee.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      creditsToAdd,
      tenantId,
      userId
    });

    // Create Stripe Checkout Session
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${creditsToAdd.toLocaleString()} Credits`,
              description: 'LAD Platform Credits',
            },
            unit_amount: Math.round(amount * 100), // Base amount in cents
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'VAT (5%)',
              description: 'Value Added Tax',
            },
            unit_amount: Math.round(vatAmount * 100), // VAT in cents
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Payment Processing Fee',
              description: 'Stripe payment processing',
            },
            unit_amount: Math.round(stripeFee * 100), // Stripe fee in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl || `${process.env.FRONTEND_URL}/settings?tab=credits&payment=success`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/settings?tab=credits&payment=cancelled`,
      client_reference_id: tenantId,
      metadata: {
        ...(metadata || {}),
        tenantId: tenantId,
        userId: userId,
        credits: creditsToAdd.toString(),
        dollarAmount: amount.toString(),
        baseAmount: amount.toString(),
        vatAmount: vatAmount.toFixed(2),
        stripeFee: stripeFee.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
      },
      // Optional: Pre-fill customer email
      customer_email: req.user?.email || undefined,
    });

    logger.info('[Stripe] Checkout session created', {
      sessionId: session.id,
      tenantId,
      userId,
      amount
    });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    logger.error('[Stripe] Error creating checkout session', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
});

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events (payment confirmation, etc.)
 * Note: Raw body parsing is handled in app.js before this route
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    if (!webhookSecret) {
      logger.warn('[Stripe] Webhook secret not configured');
      return res.status(501).json({ error: 'Webhook not configured' });
    }

    const stripeClient = getStripe();
    if (!stripeClient) {
      return res.status(501).json({ error: 'Stripe not configured' });
    }

    // Verify webhook signature
    const event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);

    logger.info('[Stripe] Webhook event received', {
      type: event.type,
      id: event.id
    });

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        
        // Extract metadata
        const tenantId = session.metadata?.tenantId || session.client_reference_id;
        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || '0');

        logger.info('[Stripe] Processing checkout completion', {
          tenantId,
          userId,
          creditsFromMetadata: session.metadata?.credits,
          creditsParsed: credits,
          sessionMetadata: session.metadata
        });

        if (!tenantId || !credits) {
          logger.error('[Stripe] Missing required metadata in webhook', { session });
          return res.status(400).json({ error: 'Missing metadata' });
        }

        // Add credits to tenant's wallet using creditWalletAtomic
        const billingService = require('../services/billingService');
        await billingService.creditWalletAtomic({
          tenantId,
          amount: credits,
          referenceType: 'stripe_purchase',
          referenceId: userId || null,
          idempotencyKey: `stripe_${session.id}`,
          description: `Stripe payment - ${credits} credits purchased`,
          metadata: {
            stripeSessionId: session.id,
            paymentIntentId: session.payment_intent,
            userId,
            amountPaid: (session.amount_total / 100).toFixed(2),
            currency: session.currency
          }
        });

        logger.info('[Stripe] Credits added after successful payment', {
          tenantId,
          userId,
          credits,
          sessionId: session.id
        });

        break;
      }

      case 'payment_intent.succeeded':
        logger.info('[Stripe] Payment intent succeeded', { id: event.data.object.id });
        break;

      case 'payment_intent.payment_failed':
        logger.warn('[Stripe] Payment intent failed', { id: event.data.object.id });
        break;

      default:
        logger.debug('[Stripe] Unhandled webhook event type', { type: event.type });
    }

    res.json({ received: true });

  } catch (error) {
    logger.error('[Stripe] Webhook error', {
      error: error.message,
      stack: error.stack
    });

    res.status(400).json({
      success: false,
      error: `Webhook Error: ${error.message}`
    });
  }
});

module.exports = router;
