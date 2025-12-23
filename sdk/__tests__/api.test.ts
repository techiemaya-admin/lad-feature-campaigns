/**
 * Campaigns SDK API Tests
 * 
 * Tests for API functions - ensures correct paths and payloads
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/sdk/shared/apiClient';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  activateCampaign,
  pauseCampaign,
  archiveCampaign,
  getCampaignSteps,
  addCampaignStep,
  updateCampaignStep,
  deleteCampaignStep,
  getCampaignLeads,
  addLeadsToCampaign,
  removeLeadFromCampaign,
  executeCampaign,
  getCampaignStats,
} from '../api';
import type { Campaign, CampaignStep, CampaignLead } from '../types';

describe('Campaigns SDK – API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCampaigns', () => {
    it('fetches campaigns using feature-prefixed path', async () => {
      const mockCampaigns: Campaign[] = [
        {
          id: 'campaign-1',
          name: 'Test Campaign',
          type: 'email',
          status: 'active',
          organization_id: 'org-1',
          user_id: 'user-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];
      
      (apiClient.get as any).mockResolvedValueOnce({ data: mockCampaigns });

      const result = await getCampaigns();

      expect(apiClient.get).toHaveBeenCalledWith('/campaigns');
      expect(result).toEqual(mockCampaigns);
    });

    it('includes query parameters when provided', async () => {
      (apiClient.get as any).mockResolvedValueOnce({ data: [] });

      await getCampaigns({ status: 'active', type: 'email', search: 'test' });

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/campaigns?')
      );
      const callArg = (apiClient.get as any).mock.calls[0][0];
      expect(callArg).toContain('status=active');
      expect(callArg).toContain('type=email');
      expect(callArg).toContain('search=test');
    });
  });

  describe('getCampaign', () => {
    it('fetches a single campaign by ID', async () => {
      const mockCampaign: Campaign = {
        id: 'campaign-1',
        name: 'Test Campaign',
        type: 'email',
        status: 'active',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      (apiClient.get as any).mockResolvedValueOnce({ data: mockCampaign });

      const result = await getCampaign('campaign-1');

      expect(apiClient.get).toHaveBeenCalledWith('/campaigns/campaign-1');
      expect(result).toEqual(mockCampaign);
    });
  });

  describe('createCampaign', () => {
    it('creates a campaign with correct payload', async () => {
      const input = {
        name: 'New Campaign',
        description: 'Test campaign',
        type: 'multi-channel' as const,
      };

      const mockResponse: Campaign = {
        id: 'campaign-new',
        ...input,
        status: 'draft',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      (apiClient.post as any).mockResolvedValueOnce({ data: mockResponse });

      const result = await createCampaign(input);

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns', input);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('updateCampaign', () => {
    it('updates a campaign', async () => {
      const updates = { name: 'Updated Campaign' };
      (apiClient.put as any).mockResolvedValueOnce({ data: { success: true } });

      await updateCampaign('campaign-1', updates);

      expect(apiClient.put).toHaveBeenCalledWith('/campaigns/campaign-1', updates);
    });
  });

  describe('deleteCampaign', () => {
    it('deletes a campaign', async () => {
      (apiClient.delete as any).mockResolvedValueOnce({});

      await deleteCampaign('campaign-1');

      expect(apiClient.delete).toHaveBeenCalledWith('/campaigns/campaign-1');
    });
  });

  describe('Campaign Actions', () => {
    it('activates a campaign', async () => {
      (apiClient.post as any).mockResolvedValueOnce({ data: { status: 'active' } });

      await activateCampaign('campaign-1');

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/activate');
    });

    it('pauses a campaign', async () => {
      (apiClient.post as any).mockResolvedValueOnce({ data: { status: 'paused' } });

      await pauseCampaign('campaign-1');

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/pause');
    });

    it('archives a campaign', async () => {
      (apiClient.post as any).mockResolvedValueOnce({ data: { status: 'archived' } });

      await archiveCampaign('campaign-1');

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/archive');
    });
  });

  describe('Campaign Steps', () => {
    it('fetches campaign steps', async () => {
      const mockSteps: CampaignStep[] = [
        {
          id: 'step-1',
          campaign_id: 'campaign-1',
          step_order: 1,
          step_type: 'send',
          channel: 'email',
          is_active: true,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      (apiClient.get as any).mockResolvedValueOnce({ data: mockSteps });

      const result = await getCampaignSteps('campaign-1');

      expect(apiClient.get).toHaveBeenCalledWith('/campaigns/campaign-1/steps');
      expect(result).toEqual(mockSteps);
    });

    it('adds a campaign step', async () => {
      const stepData = {
        step_order: 1,
        step_type: 'send' as const,
        channel: 'email' as const,
        is_active: true,
      };

      (apiClient.post as any).mockResolvedValueOnce({ data: { id: 'step-1', ...stepData } });

      await addCampaignStep('campaign-1', stepData);

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/steps', stepData);
    });

    it('updates a campaign step', async () => {
      const updates = { is_active: false };

      (apiClient.put as any).mockResolvedValueOnce({ data: { success: true } });

      await updateCampaignStep('campaign-1', 'step-1', updates);

      expect(apiClient.put).toHaveBeenCalledWith(
        '/campaigns/campaign-1/steps/step-1',
        updates
      );
    });

    it('deletes a campaign step', async () => {
      (apiClient.delete as any).mockResolvedValueOnce({});

      await deleteCampaignStep('campaign-1', 'step-1');

      expect(apiClient.delete).toHaveBeenCalledWith('/campaigns/campaign-1/steps/step-1');
    });
  });

  describe('Campaign Leads', () => {
    it('fetches campaign leads', async () => {
      const mockLeads: CampaignLead[] = [
        {
          id: 'cl-1',
          campaign_id: 'campaign-1',
          lead_id: 'lead-1',
          status: 'pending',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      (apiClient.get as any).mockResolvedValueOnce({ data: mockLeads });

      const result = await getCampaignLeads('campaign-1');

      expect(apiClient.get).toHaveBeenCalledWith('/campaigns/campaign-1/leads');
      expect(result).toEqual(mockLeads);
    });

    it('adds leads to campaign', async () => {
      const leadIds = { leadIds: ['lead-1', 'lead-2'] };

      (apiClient.post as any).mockResolvedValueOnce({ data: { added: 2, failed: 0 } });

      await addLeadsToCampaign('campaign-1', leadIds);

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/leads', leadIds);
    });

    it('removes a lead from campaign', async () => {
      (apiClient.delete as any).mockResolvedValueOnce({});

      await removeLeadFromCampaign('campaign-1', 'lead-1');

      expect(apiClient.delete).toHaveBeenCalledWith('/campaigns/campaign-1/leads/lead-1');
    });
  });

  describe('executeCampaign', () => {
    it('executes a campaign', async () => {
      (apiClient.post as any).mockResolvedValueOnce({ data: { success: true, executed: 50 } });

      const result = await executeCampaign('campaign-1');

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/execute', {});
      expect(result).toEqual({ success: true, executed: 50 });
    });

    it('executes campaign with specific lead IDs', async () => {
      const options = { leadIds: ['lead-1', 'lead-2'] };

      (apiClient.post as any).mockResolvedValueOnce({ data: { success: true, executed: 2 } });

      await executeCampaign('campaign-1', options);

      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/campaign-1/execute', options);
    });
  });

  describe('getCampaignStats', () => {
    it('fetches campaign statistics', async () => {
      const mockStats = {
        total_campaigns: 10,
        active_campaigns: 5,
        total_leads: 1000,
        total_sent: 800,
        total_delivered: 750,
        total_connected: 400,
        total_replied: 120,
        avg_connection_rate: 50.0,
        avg_reply_rate: 15.0,
      };

      (apiClient.get as any).mockResolvedValueOnce({ data: mockStats });

      const result = await getCampaignStats();

      expect(apiClient.get).toHaveBeenCalledWith('/campaigns/stats');
      expect(result).toEqual(mockStats);
    });
  });
});
