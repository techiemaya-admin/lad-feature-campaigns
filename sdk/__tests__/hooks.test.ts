/**
 * Campaigns SDK Hooks Tests
 * 
 * Tests for React hooks - ensures proper state management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useCampaigns,
  useCampaign,
  useCampaignSteps,
  useCampaignLeads,
  useCampaignStats,
} from '../hooks';
import * as api from '../api';
import type { Campaign, CampaignStep, CampaignLead } from '../types';

describe('Campaigns SDK – Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useCampaigns', () => {
    it('loads campaigns via SDK API', async () => {
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

      vi.spyOn(api, 'getCampaigns').mockResolvedValueOnce(mockCampaigns);

      const { result } = renderHook(() => useCampaigns());

      await act(async () => {
        await result.current.load();
      });

      await waitFor(() => {
        expect(result.current.campaigns.length).toBe(1);
        expect(result.current.campaigns[0].name).toBe('Test Campaign');
        expect(api.getCampaigns).toHaveBeenCalled();
      });
    });

    it('creates a new campaign', async () => {
      const newCampaign: Campaign = {
        id: 'campaign-new',
        name: 'New Campaign',
        type: 'email',
        status: 'draft',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      vi.spyOn(api, 'createCampaign').mockResolvedValueOnce(newCampaign);

      const { result } = renderHook(() => useCampaigns());

      await act(async () => {
        await result.current.create({
          name: 'New Campaign',
          type: 'email',
        });
      });

      await waitFor(() => {
        expect(result.current.campaigns.length).toBe(1);
        expect(result.current.campaigns[0].name).toBe('New Campaign');
        expect(api.createCampaign).toHaveBeenCalledWith({
          name: 'New Campaign',
          type: 'email',
        });
      });
    });

    it('removes a campaign', async () => {
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

      vi.spyOn(api, 'getCampaigns').mockResolvedValueOnce(mockCampaigns);
      vi.spyOn(api, 'deleteCampaign').mockResolvedValueOnce();

      const { result } = renderHook(() => useCampaigns());

      await act(async () => {
        await result.current.load();
      });

      await act(async () => {
        await result.current.remove('campaign-1');
      });

      await waitFor(() => {
        expect(result.current.campaigns.length).toBe(0);
        expect(api.deleteCampaign).toHaveBeenCalledWith('campaign-1');
      });
    });
  });

  describe('useCampaign', () => {
    it('loads a single campaign', async () => {
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

      vi.spyOn(api, 'getCampaign').mockResolvedValueOnce(mockCampaign);

      const { result } = renderHook(() => useCampaign('campaign-1'));

      await act(async () => {
        await result.current.load();
      });

      await waitFor(() => {
        expect(result.current.campaign?.name).toBe('Test Campaign');
        expect(api.getCampaign).toHaveBeenCalledWith('campaign-1');
      });
    });

    it('updates a campaign', async () => {
      const updatedCampaign: Campaign = {
        id: 'campaign-1',
        name: 'Updated Campaign',
        type: 'email',
        status: 'active',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      vi.spyOn(api, 'updateCampaign').mockResolvedValueOnce(updatedCampaign);

      const { result } = renderHook(() => useCampaign('campaign-1'));

      await act(async () => {
        await result.current.update({ name: 'Updated Campaign' });
      });

      await waitFor(() => {
        expect(result.current.campaign?.name).toBe('Updated Campaign');
        expect(api.updateCampaign).toHaveBeenCalledWith('campaign-1', {
          name: 'Updated Campaign',
        });
      });
    });

    it('activates a campaign', async () => {
      const activeCampaign: Campaign = {
        id: 'campaign-1',
        name: 'Test Campaign',
        type: 'email',
        status: 'active',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      vi.spyOn(api, 'activateCampaign').mockResolvedValueOnce(activeCampaign);

      const { result } = renderHook(() => useCampaign('campaign-1'));

      await act(async () => {
        await result.current.activate();
      });

      await waitFor(() => {
        expect(result.current.campaign?.status).toBe('active');
        expect(api.activateCampaign).toHaveBeenCalledWith('campaign-1');
      });
    });
  });

  describe('useCampaignSteps', () => {
    it('loads campaign steps', async () => {
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

      vi.spyOn(api, 'getCampaignSteps').mockResolvedValueOnce(mockSteps);

      const { result } = renderHook(() => useCampaignSteps('campaign-1'));

      await act(async () => {
        await result.current.load();
      });

      await waitFor(() => {
        expect(result.current.steps.length).toBe(1);
        expect(api.getCampaignSteps).toHaveBeenCalledWith('campaign-1');
      });
    });

    it('adds a new step', async () => {
      const newStep: CampaignStep = {
        id: 'step-1',
        campaign_id: 'campaign-1',
        step_order: 1,
        step_type: 'send',
        channel: 'email',
        is_active: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      vi.spyOn(api, 'addCampaignStep').mockResolvedValueOnce(newStep);

      const { result } = renderHook(() => useCampaignSteps('campaign-1'));

      await act(async () => {
        await result.current.add({
          step_order: 1,
          step_type: 'send',
          channel: 'email',
          is_active: true,
        });
      });

      await waitFor(() => {
        expect(result.current.steps.length).toBe(1);
        expect(api.addCampaignStep).toHaveBeenCalled();
      });
    });
  });

  describe('useCampaignLeads', () => {
    it('loads campaign leads', async () => {
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

      vi.spyOn(api, 'getCampaignLeads').mockResolvedValueOnce(mockLeads);

      const { result } = renderHook(() => useCampaignLeads('campaign-1'));

      await act(async () => {
        await result.current.load();
      });

      await waitFor(() => {
        expect(result.current.leads.length).toBe(1);
        expect(api.getCampaignLeads).toHaveBeenCalledWith('campaign-1', undefined);
      });
    });

    it('adds leads to campaign', async () => {
      vi.spyOn(api, 'addLeadsToCampaign').mockResolvedValueOnce({ added: 2, failed: 0 });
      vi.spyOn(api, 'getCampaignLeads').mockResolvedValueOnce([]);

      const { result } = renderHook(() => useCampaignLeads('campaign-1'));

      await act(async () => {
        await result.current.addLeads({ leadIds: ['lead-1', 'lead-2'] });
      });

      await waitFor(() => {
        expect(api.addLeadsToCampaign).toHaveBeenCalledWith('campaign-1', {
          leadIds: ['lead-1', 'lead-2'],
        });
      });
    });
  });

  describe('useCampaignStats', () => {
    it('loads campaign statistics', async () => {
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

      vi.spyOn(api, 'getCampaignStats').mockResolvedValueOnce(mockStats);

      const { result } = renderHook(() => useCampaignStats());

      await act(async () => {
        await result.current.load();
      });

      await waitFor(() => {
        expect(result.current.stats?.total_campaigns).toBe(10);
        expect(api.getCampaignStats).toHaveBeenCalled();
      });
    });
  });
});
