# LAD Credit-Based Billing System

## Architecture Overview

The LAD billing system implements a **credit-based prepaid model** with:

- **Wallets**: Each tenant has a credit wallet with cached balance
- **Ledger**: Immutable transaction log (source of truth for all balance changes)
- **Usage Events**: Idempotent records of feature usage with multi-component support
- **Pricing Catalog**: Tenant-aware pricing with global defaults and overrides
- **Atomic Operations**: Concurrency-safe wallet updates using `SELECT FOR UPDATE`

## Database Schema

### Tables Created

1. **billing_wallets** - Credit balances per tenant
2. **billing_ledger_transactions** - Immutable audit log of all credit changes
3. **billing_usage_events** - Metered usage records (idempotent)
4. **billing_pricing_catalog** - Price lookup table (already exists)
5. **billing_invoices** - Invoice generation (stub for future)
6. **billing_feature_entitlements** - Feature quotas and limits (optional)

### Key Design Principles

- **Tenant-scoped**: Every record has `tenant_id`
- **Idempotent**: All operations use `idempotency_key` to prevent double-charging
- **Atomic**: Wallet updates and ledger inserts happen in same transaction
- **Audit-safe**: Ledger stores `balance_before` and `balance_after` snapshots
- **Concurrency-safe**: Uses row-level locks to prevent race conditions

## Installation

### 1. Run Migration

```bash
cd backend
node scripts/run-billing-migration.js
```

This creates all billing tables and seeds default pricing.

### 2. Verify Setup

```bash
node scripts/test-billing-system.js
```

## API Endpoints

### Authentication

All billing endpoints require authentication. Include JWT token in Authorization header:

```bash
Authorization: Bearer <jwt_token>
```

### 1. Get Pricing Catalog

**Resolve specific price:**
```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/pricing?category=stt&provider=openai&model=whisper-1&unit=second" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "price": {
    "priceId": "uuid",
    "unitPrice": 0.0001,
    "category": "stt",
    "provider": "openai",
    "model": "whisper-1",
    "unit": "second",
    "description": "OpenAI Whisper STT per second",
    "isTenantOverride": false
  }
}
```

**List all pricing:**
```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/pricing" \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Get Quote (Estimate Cost)

```bash
curl -X POST "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/quote" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "category": "stt",
        "provider": "openai",
        "model": "whisper-1",
        "unit": "second",
        "quantity": 60
      },
      {
        "category": "llm",
        "provider": "openai",
        "model": "gpt-4",
        "unit": "token",
        "quantity": 500
      },
      {
        "category": "tts",
        "provider": "openai",
        "model": "tts-1",
        "unit": "character",
        "quantity": 200
      }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "quote": {
    "items": [
      {
        "category": "stt",
        "provider": "openai",
        "model": "whisper-1",
        "unit": "second",
        "quantity": 60,
        "unitPrice": 0.0001,
        "cost": 0.006,
        "description": "OpenAI Whisper STT per second"
      },
      {
        "category": "llm",
        "provider": "openai",
        "model": "gpt-4",
        "unit": "token",
        "quantity": 500,
        "unitPrice": 0.00003,
        "cost": 0.015,
        "description": "OpenAI GPT-4 per token"
      },
      {
        "category": "tts",
        "provider": "openai",
        "model": "tts-1",
        "unit": "character",
        "quantity": 200,
        "unitPrice": 0.000015,
        "cost": 0.003,
        "description": "OpenAI TTS per character"
      }
    ],
    "totalCost": 0.024,
    "currency": "USD"
  }
}
```

### 3. Get Wallet Balance

```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/wallet" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "walletId": "uuid",
    "tenantId": "uuid",
    "currentBalance": 50.00,
    "reservedBalance": 0,
    "availableBalance": 50.00,
    "currency": "USD",
    "status": "active",
    "lowBalanceThreshold": null
  }
}
```

### 4. Top Up Credits (Admin Only)

**Requires:** `billing.admin` capability or `owner` role

```bash
curl -X POST "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/topup" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "description": "Credit purchase via Stripe",
    "metadata": {
      "stripePaymentId": "pi_xxxxx"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "transaction": {
    "id": "uuid",
    "transaction_type": "topup",
    "amount": 100.00,
    "balance_before": 50.00,
    "balance_after": 150.00,
    "created_at": "2025-12-27T10:00:00Z"
  },
  "wallet": {
    "currentBalance": 150.00,
    "availableBalance": 150.00
  }
}
```

### 5. Create and Charge Usage

**Idempotent:** Uses `idempotencyKey` to prevent duplicate charges

```bash
curl -X POST "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/charge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "featureKey": "voice-agent",
    "idempotencyKey": "call_12345",
    "externalReferenceId": "call_12345",
    "chargeImmediately": true,
    "items": [
      {
        "category": "stt",
        "provider": "openai",
        "model": "whisper-1",
        "unit": "second",
        "quantity": 45
      },
      {
        "category": "llm",
        "provider": "openai",
        "model": "gpt-4",
        "unit": "token",
        "quantity": 350
      },
      {
        "category": "tts",
        "provider": "openai",
        "model": "tts-1",
        "unit": "character",
        "quantity": 150
      },
      {
        "category": "telephony",
        "provider": "twilio",
        "model": "voice",
        "unit": "minute",
        "quantity": 0.75
      }
    ],
    "metadata": {
      "callDuration": 45,
      "phoneNumber": "+1234567890"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "usageEvent": {
    "id": "uuid",
    "tenant_id": "uuid",
    "user_id": "uuid",
    "feature_key": "voice-agent",
    "status": "charged",
    "total_cost": 0.0235,
    "total_quantity": 545.75,
    "idempotency_key": "call_12345",
    "external_reference_id": "call_12345",
    "created_at": "2025-12-27T10:05:00Z",
    "charged_at": "2025-12-27T10:05:00Z"
  },
  "ledgerTransaction": {
    "id": "uuid",
    "transaction_type": "debit",
    "amount": -0.0235,
    "balance_before": 150.00,
    "balance_after": 149.9765
  }
}
```

**Insufficient Balance Response (402):**
```json
{
  "success": false,
  "error": "Insufficient balance. Required: 0.0235, Available: 0.01"
}
```

### 6. Get Usage History

```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/usage?featureKey=voice-agent&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Query Parameters:**
- `featureKey` - Filter by feature (optional)
- `status` - Filter by status: pending, charged, voided, failed (optional)
- `fromDate` - Start date (ISO 8601) (optional)
- `toDate` - End date (ISO 8601) (optional)
- `limit` - Results per page (default: 100)
- `offset` - Pagination offset (default: 0)
- `aggregate` - Return summary instead of details (true/false)

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "id": "uuid",
      "feature_key": "voice-agent",
      "total_cost": 0.0235,
      "status": "charged",
      "external_reference_id": "call_12345",
      "created_at": "2025-12-27T10:05:00Z",
      "user_email": "admin@glinks.com"
    }
  ],
  "count": 1,
  "pagination": {
    "limit": 10,
    "offset": 0
  }
}
```

**Aggregated Summary:**
```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/usage?aggregate=true" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "summary": [
    {
      "feature_key": "voice-agent",
      "status": "charged",
      "event_count": 15,
      "total_quantity": 5432.50,
      "total_cost": 1.245,
      "currency": "USD"
    }
  ],
  "aggregated": true
}
```

### 7. Get Transaction Ledger

```bash
curl -X GET "https://lad-backend-develop-741719885039.us-central1.run.app/api/billing/transactions?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "success": true,
  "transactions": [
    {
      "id": "uuid",
      "transaction_type": "debit",
      "amount": -0.0235,
      "balance_before": 150.00,
      "balance_after": 149.9765,
      "reference_type": "usage_event",
      "reference_id": "uuid",
      "description": "Charge for voice-agent",
      "created_at": "2025-12-27T10:05:00Z",
      "created_by_email": "admin@glinks.com"
    },
    {
      "id": "uuid",
      "transaction_type": "topup",
      "amount": 100.00,
      "balance_before": 50.00,
      "balance_after": 150.00,
      "reference_type": "manual",
      "description": "Credit purchase via Stripe",
      "created_at": "2025-12-27T10:00:00Z"
    }
  ],
  "count": 2
}
```

## Feature Integration

### Voice Agent Example

Features should **emit usage events** to the billing system, not implement billing logic themselves.

```javascript
const { recordVoiceCallUsage } = require('./billing/voiceAgentBilling');

// After completing a voice call
async function handleCallCompleted(callData) {
  try {
    // Record usage and charge
    const result = await recordVoiceCallUsage({
      tenantId: callData.tenantId,
      userId: callData.userId,
      callId: callData.callId, // Used for idempotency
      usage: {
        sttSeconds: 45,
        sttProvider: 'openai',
        sttModel: 'whisper-1',
        llmPromptTokens: 200,
        llmCompletionTokens: 150,
        llmProvider: 'openai',
        llmModel: 'gpt-4',
        ttsCharacters: 150,
        ttsProvider: 'openai',
        ttsModel: 'tts-1',
        telephonyMinutes: 0.75,
        telephonyProvider: 'twilio',
        vmSeconds: 45,
        vmProvider: 'runpod'
      },
      metadata: {
        phoneNumber: callData.phoneNumber,
        duration: callData.duration
      }
    });
    
    console.log(`Call charged: $${result.usageEvent.total_cost}`);
    
  } catch (error) {
    if (error.message.includes('Insufficient balance')) {
      // Handle low balance
      await notifyLowBalance(callData.tenantId);
    }
    throw error;
  }
}
```

### Pre-Call Balance Check

```javascript
const { canAffordCall } = require('./billing/voiceAgentBilling');

async function checkBeforeCall(tenantId, estimatedDuration) {
  const check = await canAffordCall({
    tenantId,
    estimatedDuration: 60 // seconds
  });
  
  if (!check.canAfford) {
    return {
      allowed: false,
      message: `Insufficient balance. Estimated cost: $${check.estimatedCost}, Available: $${check.availableBalance}`
    };
  }
  
  return { allowed: true };
}
```

## Permissions

### Billing Capabilities

Add these capabilities to users who need billing access:

- **billing.admin** - Can top up credits, view all billing data
- **billing.view** - Can view wallet balance and usage reports

### Grant Billing Admin

```sql
INSERT INTO user_capabilities (user_id, capability_key)
VALUES ('user-uuid', 'billing.admin');
```

Or use the existing script pattern:
```bash
node scripts/add-capabilities.js <user-id> billing.admin billing.view
```

## Error Handling

### Common Error Codes

- **400** - Bad request (missing required fields)
- **402** - Payment required (insufficient balance)
- **403** - Forbidden (no permission or feature not enabled)
- **404** - Not found (pricing not found, usage event not found)
- **500** - Internal server error

### Insufficient Balance

When wallet balance is too low, charge endpoints return 402:

```json
{
  "success": false,
  "error": "Insufficient balance. Required: 0.50, Available: 0.25"
}
```

### Idempotency

Duplicate requests with same `idempotencyKey` return the original result without charging again.

## Testing

### Run Full Test Suite

```bash
node scripts/test-billing-system.js
```

Tests cover:
1. Price resolution
2. Quote generation
3. Wallet operations (top-up, debit)
4. Usage event creation
5. Charging usage events
6. Idempotency verification
7. Usage history
8. Transaction ledger
9. Create and charge immediately

### Manual Testing

1. **Create test wallet:**
```bash
curl -X POST "http://localhost:3004/api/billing/topup" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10}'
```

2. **Make test charge:**
```bash
curl -X POST "http://localhost:3004/api/billing/charge" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "featureKey": "test",
    "idempotencyKey": "test_'$(date +%s)'",
    "items": [{"category": "stt", "provider": "openai", "model": "whisper-1", "unit": "second", "quantity": 10}]
  }'
```

3. **Check balance:**
```bash
curl -X GET "http://localhost:3004/api/billing/wallet" \
  -H "Authorization: Bearer $TOKEN"
```

## Future Enhancements

### Stripe Integration

The `/api/billing/webhooks/stripe` endpoint is stubbed for future implementation:

- Payment intent handling
- Automatic top-ups
- Invoice generation
- Subscription management

### Feature Quotas

Use `billing_feature_entitlements` table to implement:

- Monthly usage limits per feature
- Overage billing at custom rates
- Feature throttling based on plan

### Multi-Currency

Currently only USD is supported. To add currencies:

1. Add currency column to pricing_catalog
2. Update resolvePrice() to filter by currency
3. Add currency conversion logic

## Troubleshooting

### Migration Fails

Check database connection:
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT version();"
```

### Pricing Not Found

Verify pricing catalog has entries:
```sql
SELECT * FROM billing_pricing_catalog WHERE tenant_id IS NULL LIMIT 10;
```

If empty, re-run migration to seed default prices.

### Balance Mismatch

Audit ledger vs wallet:
```sql
SELECT 
  w.current_balance as wallet_balance,
  (SELECT SUM(amount) FROM billing_ledger_transactions WHERE wallet_id = w.id) as ledger_sum
FROM billing_wallets w
WHERE tenant_id = 'your-tenant-id';
```

Should match. If not, wallet balance cache is stale (rebuild from ledger).

### Duplicate Charges

Check idempotency key uniqueness:
```sql
SELECT idempotency_key, COUNT(*) 
FROM billing_ledger_transactions 
WHERE tenant_id = 'your-tenant-id'
GROUP BY idempotency_key 
HAVING COUNT(*) > 1;
```

Should return no rows. If duplicates exist, idempotency is broken.

## Support

For issues or questions:
- Check logs: `docker logs lad-backend` or Cloud Run logs
- Review test output: `node scripts/test-billing-system.js`
- Verify pricing: `SELECT * FROM billing_pricing_catalog`
- Check wallet: `SELECT * FROM billing_wallets WHERE tenant_id = 'xxx'`
