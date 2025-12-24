# Campaigns SDK

Frontend SDK for the Campaigns feature following LAD standard patterns.

## 📁 Structure

```
sdk/
├── api.ts              # API functions (feature-prefixed paths)
├── hooks.ts            # React hooks for state management
├── types.ts            # TypeScript type definitions
├── index.ts            # Main exports
└── __tests__/
    ├── setup.ts        # Mock API client
    ├── api.test.ts     # API function tests
    └── hooks.test.ts   # Hook tests
```

## 🚀 Usage

### Import from SDK

```typescript
import {
  useCampaigns,
  useCampaign,
  getCampaign,
  createCampaign,
  type Campaign,
  type CampaignStatus,
} from '@/sdk/features/campaigns';
```

### API Functions

All API paths are feature-prefixed (`/campaigns/*`):

```typescript
// Get all campaigns
const campaigns = await getCampaigns({ status: 'active' });

// Get single campaign
const campaign = await getCampaign('campaign-id');

// Create campaign
const newCampaign = await createCampaign({
  name: 'Q1 Outreach',
  type: 'multi-channel',
  description: 'Enterprise leads'
});

// Update campaign
const updated = await updateCampaign('campaign-id', {
  name: 'Updated Name'
});

// Campaign actions
await activateCampaign('campaign-id');
await pauseCampaign('campaign-id');
await archiveCampaign('campaign-id');
await executeCampaign('campaign-id');
```

### React Hooks

```typescript
// List campaigns
function CampaignsList() {
  const { campaigns, loading, error, load } = useCampaigns();

  useEffect(() => {
    load({ status: 'active' });
  }, []);

  return (
    <div>
      {campaigns.map(campaign => (
        <div key={campaign.id}>{campaign.name}</div>
      ))}
    </div>
  );
}

// Single campaign
function CampaignDetail({ id }: { id: string }) {
  const { campaign, loading, activate, pause } = useCampaign(id);

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h1>{campaign?.name}</h1>
      <button onClick={activate}>Activate</button>
      <button onClick={pause}>Pause</button>
    </div>
  );
}

// Campaign steps
function CampaignSteps({ campaignId }: { campaignId: string }) {
  const { steps, add, update, remove } = useCampaignSteps(campaignId);

  const addEmailStep = async () => {
    await add({
      step_order: steps.length + 1,
      step_type: 'send',
      channel: 'email',
      content: {
        subject: 'Hello',
        body: 'Welcome'
      },
      is_active: true
    });
  };

  return (
    <div>
      {steps.map(step => (
        <div key={step.id}>{step.step_type}</div>
      ))}
      <button onClick={addEmailStep}>Add Email Step</button>
    </div>
  );
}

// Campaign leads
function CampaignLeads({ campaignId }: { campaignId: string }) {
  const { leads, addLeads, removeLead } = useCampaignLeads(campaignId);

  const handleAddLeads = async () => {
    await addLeads({ leadIds: ['lead-1', 'lead-2'] });
  };

  return (
    <div>
      {leads.map(lead => (
        <div key={lead.id}>
          Lead: {lead.lead_id}
          <button onClick={() => removeLead(lead.lead_id)}>Remove</button>
        </div>
      ))}
      <button onClick={handleAddLeads}>Add Leads</button>
    </div>
  );
}

// Statistics
function CampaignStats() {
  const { stats, load } = useCampaignStats();

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <p>Total: {stats?.total_campaigns}</p>
      <p>Active: {stats?.active_campaigns}</p>
      <p>Response Rate: {stats?.avg_reply_rate}%</p>
    </div>
  );
}
```

## 🧪 Testing

### Run Tests

```bash
# Run all SDK tests
npm run test:sdk

# Watch mode
npm run test:watch

# All tests
npm test
```

### Test Structure

Tests follow LAD standard patterns:

1. **Mock API Client** (`__tests__/setup.ts`)
   - Prevents real backend calls
   - Uses Vitest mocks

2. **API Tests** (`__tests__/api.test.ts`)
   - Validates feature-prefixed paths
   - Checks request payloads
   - Ensures correct HTTP methods

3. **Hook Tests** (`__tests__/hooks.test.ts`)
   - Tests state management
   - Validates hook behavior
   - No Next.js dependencies

### Example Test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { apiClient } from '@/sdk/shared/apiClient';
import { getCampaign } from '../api';

describe('Campaigns SDK – API', () => {
  it('fetches campaign using feature-prefixed path', async () => {
    const mockCampaign = { id: 'campaign-1', name: 'Test' };
    apiClient.get.mockResolvedValueOnce({ data: mockCampaign });

    const result = await getCampaign('campaign-1');

    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/campaign-1');
    expect(result).toEqual(mockCampaign);
  });
});
```

## 📝 Type Definitions

```typescript
// Campaign Types
type CampaignType = 'email' | 'voice' | 'linkedin' | 'sms' | 'multi-channel';
type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

// Main Entities
interface Campaign {
  id: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  organization_id: string;
  user_id: string;
  settings?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  step_type: 'send' | 'wait' | 'condition';
  channel?: 'email' | 'voice' | 'linkedin' | 'sms';
  content?: {
    subject?: string;
    body?: string;
    message?: string;
  };
  delay_minutes?: number;
  is_active: boolean;
}

interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  current_step?: number;
  last_contact_at?: string;
  completed_at?: string;
}
```

## ✅ Standards Compliance

This SDK follows LAD standards:

- ✅ Feature-prefixed API paths (`/campaigns/*`)
- ✅ Shared `apiClient` for all requests
- ✅ Comprehensive TypeScript types
- ✅ React hooks for state management
- ✅ Full test coverage with mocked API client
- ✅ No hardcoded backend URLs
- ✅ Proper error handling

## 🔗 Integration

### Copy to LAD Frontend

```bash
# Copy SDK to LAD frontend
cp -r sdk /path/to/LAD/frontend/web/src/sdk/features/campaigns
```

### Usage in LAD

```typescript
// Import from LAD frontend
import { useCampaigns } from '@/sdk/features/campaigns';

function MyComponent() {
  const { campaigns, load } = useCampaigns();
  // Use the hook
}
```

## 📚 API Reference

### Available Functions

- `getCampaigns(params?)` - List campaigns
- `getCampaign(id)` - Get single campaign
- `createCampaign(data)` - Create campaign
- `updateCampaign(id, data)` - Update campaign
- `deleteCampaign(id)` - Delete campaign
- `activateCampaign(id)` - Activate campaign
- `pauseCampaign(id)` - Pause campaign
- `archiveCampaign(id)` - Archive campaign
- `getCampaignSteps(id)` - Get steps
- `addCampaignStep(id, step)` - Add step
- `updateCampaignStep(id, stepId, data)` - Update step
- `deleteCampaignStep(id, stepId)` - Delete step
- `getCampaignLeads(id)` - Get leads
- `addLeadsToCampaign(id, leadIds)` - Add leads
- `removeLeadFromCampaign(id, leadId)` - Remove lead
- `executeCampaign(id, options)` - Execute campaign
- `getCampaignStats()` - Get statistics

### Available Hooks

- `useCampaigns(params?)` - Manage campaigns list
- `useCampaign(id)` - Manage single campaign
- `useCampaignSteps(campaignId)` - Manage steps
- `useCampaignLeads(campaignId)` - Manage leads
- `useCampaignStats()` - Get statistics

---

**Version:** 2.0.0  
**Last Updated:** December 22, 2025
