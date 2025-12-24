/**
 * Campaigns SDK Hooks
 * 
 * React hooks for the Campaigns feature
 */

import { useState, useCallback } from 'react';
import type {
  Campaign,
  CampaignStep,
  CampaignLead,
  CampaignLeadActivity,
  CampaignStats,
  CampaignCreateInput,
  CampaignUpdateInput,
  AddLeadsInput,
  CampaignListParams,
} from './types';
import * as api from './api';

/**
 * Hook for managing campaigns list
 */
export function useCampaigns(initialParams?: CampaignListParams) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async (params?: CampaignListParams) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCampaigns(params || initialParams);
      setCampaigns(data);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [initialParams]);

  const create = useCallback(async (data: CampaignCreateInput) => {
    try {
      setLoading(true);
      setError(null);
      const campaign = await api.createCampaign(data);
      setCampaigns((prev) => [campaign, ...prev]);
      return campaign;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (campaignId: string) => {
    try {
      setLoading(true);
      setError(null);
      await api.deleteCampaign(campaignId);
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    campaigns,
    loading,
    error,
    load,
    create,
    remove,
  };
}

/**
 * Hook for managing a single campaign
 */
export function useCampaign(campaignId: string) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCampaign(campaignId);
      setCampaign(data);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const update = useCallback(async (data: CampaignUpdateInput) => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.updateCampaign(campaignId, data);
      setCampaign(updated);
      return updated;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const activate = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.activateCampaign(campaignId);
      setCampaign(updated);
      return updated;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const pause = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.pauseCampaign(campaignId);
      setCampaign(updated);
      return updated;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const archive = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const updated = await api.archiveCampaign(campaignId);
      setCampaign(updated);
      return updated;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const execute = useCallback(async (options?: { leadIds?: string[] }) => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.executeCampaign(campaignId, options);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  return {
    campaign,
    loading,
    error,
    load,
    update,
    activate,
    pause,
    archive,
    execute,
  };
}

/**
 * Hook for managing campaign steps
 */
export function useCampaignSteps(campaignId: string) {
  const [steps, setSteps] = useState<CampaignStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCampaignSteps(campaignId);
      setSteps(data);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const add = useCallback(
    async (step: Omit<CampaignStep, 'id' | 'campaign_id' | 'created_at' | 'updated_at'>) => {
      try {
        setLoading(true);
        setError(null);
        const newStep = await api.addCampaignStep(campaignId, step);
        setSteps((prev) => [...prev, newStep].sort((a, b) => a.step_order - b.step_order));
        return newStep;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  const update = useCallback(
    async (stepId: string, data: Partial<CampaignStep>) => {
      try {
        setLoading(true);
        setError(null);
        const updated = await api.updateCampaignStep(campaignId, stepId, data);
        setSteps((prev) =>
          prev.map((s) => (s.id === stepId ? updated : s)).sort((a, b) => a.step_order - b.step_order)
        );
        return updated;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  const remove = useCallback(
    async (stepId: string) => {
      try {
        setLoading(true);
        setError(null);
        await api.deleteCampaignStep(campaignId, stepId);
        setSteps((prev) => prev.filter((s) => s.id !== stepId));
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  return {
    steps,
    loading,
    error,
    load,
    add,
    update,
    remove,
  };
}

/**
 * Hook for managing campaign leads
 */
export function useCampaignLeads(campaignId: string) {
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(
    async (params?: { status?: string; page?: number; limit?: number }) => {
      if (!campaignId) return;
      try {
        setLoading(true);
        setError(null);
        const data = await api.getCampaignLeads(campaignId, params);
        setLeads(data);
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  const addLeads = useCallback(
    async (data: AddLeadsInput) => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.addLeadsToCampaign(campaignId, data);
        // Reload leads after adding
        await load();
        return result;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId, load]
  );

  const removeLead = useCallback(
    async (leadId: string) => {
      try {
        setLoading(true);
        setError(null);
        await api.removeLeadFromCampaign(campaignId, leadId);
        setLeads((prev) => prev.filter((l) => l.lead_id !== leadId));
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

  return {
    leads,
    loading,
    error,
    load,
    addLeads,
    removeLead,
  };
}

/**
 * Hook for campaign statistics
 */
export function useCampaignStats() {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCampaignStats();
      setStats(data);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    stats,
    loading,
    error,
    load,
  };
}
