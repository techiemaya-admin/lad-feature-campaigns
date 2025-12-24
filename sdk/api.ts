/**
 * Campaigns SDK API
 * 
 * API functions for interacting with the Campaigns feature
 * All paths are feature-prefixed: /campaigns/*
 */

import { apiClient } from '@/sdk/shared/apiClient';
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

/**
 * Get all campaigns
 */
export async function getCampaigns(params?: CampaignListParams): Promise<Campaign[]> {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.type) queryParams.append('type', params.type);
  if (params?.search) queryParams.append('search', params.search);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.limit) queryParams.append('limit', String(params.limit));

  const query = queryParams.toString();
  const path = query ? `/campaigns?${query}` : '/campaigns';
  
  const response = await apiClient.get<{ data: Campaign[] }>(path);
  return response.data;
}

/**
 * Get campaign by ID
 */
export async function getCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiClient.get<{ data: Campaign }>(`/campaigns/${campaignId}`);
  return response.data;
}

/**
 * Create new campaign
 */
export async function createCampaign(data: CampaignCreateInput): Promise<Campaign> {
  const response = await apiClient.post<{ data: Campaign }>('/campaigns', data);
  return response.data;
}

/**
 * Update campaign
 */
export async function updateCampaign(
  campaignId: string,
  data: CampaignUpdateInput
): Promise<Campaign> {
  const response = await apiClient.put<{ data: Campaign }>(`/campaigns/${campaignId}`, data);
  return response.data;
}

/**
 * Delete campaign
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  await apiClient.delete(`/campaigns/${campaignId}`);
}

/**
 * Activate campaign
 */
export async function activateCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiClient.post<{ data: Campaign }>(`/campaigns/${campaignId}/activate`);
  return response.data;
}

/**
 * Pause campaign
 */
export async function pauseCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiClient.post<{ data: Campaign }>(`/campaigns/${campaignId}/pause`);
  return response.data;
}

/**
 * Archive campaign
 */
export async function archiveCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiClient.post<{ data: Campaign }>(`/campaigns/${campaignId}/archive`);
  return response.data;
}

/**
 * Get campaign steps
 */
export async function getCampaignSteps(campaignId: string): Promise<CampaignStep[]> {
  const response = await apiClient.get<{ data: CampaignStep[] }>(`/campaigns/${campaignId}/steps`);
  return response.data;
}

/**
 * Add step to campaign
 */
export async function addCampaignStep(
  campaignId: string,
  step: Omit<CampaignStep, 'id' | 'campaign_id' | 'created_at' | 'updated_at'>
): Promise<CampaignStep> {
  const response = await apiClient.post<{ data: CampaignStep }>(
    `/campaigns/${campaignId}/steps`,
    step
  );
  return response.data;
}

/**
 * Update campaign step
 */
export async function updateCampaignStep(
  campaignId: string,
  stepId: string,
  step: Partial<CampaignStep>
): Promise<CampaignStep> {
  const response = await apiClient.put<{ data: CampaignStep }>(
    `/campaigns/${campaignId}/steps/${stepId}`,
    step
  );
  return response.data;
}

/**
 * Delete campaign step
 */
export async function deleteCampaignStep(campaignId: string, stepId: string): Promise<void> {
  await apiClient.delete(`/campaigns/${campaignId}/steps/${stepId}`);
}

/**
 * Get campaign leads
 */
export async function getCampaignLeads(
  campaignId: string,
  params?: { status?: string; page?: number; limit?: number }
): Promise<CampaignLead[]> {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.limit) queryParams.append('limit', String(params.limit));

  const query = queryParams.toString();
  const path = query
    ? `/campaigns/${campaignId}/leads?${query}`
    : `/campaigns/${campaignId}/leads`;

  const response = await apiClient.get<{ data: CampaignLead[] }>(path);
  return response.data;
}

/**
 * Add leads to campaign
 */
export async function addLeadsToCampaign(
  campaignId: string,
  data: AddLeadsInput
): Promise<{ added: number; failed: number }> {
  const response = await apiClient.post<{ data: { added: number; failed: number } }>(
    `/campaigns/${campaignId}/leads`,
    data
  );
  return response.data;
}

/**
 * Remove lead from campaign
 */
export async function removeLeadFromCampaign(
  campaignId: string,
  leadId: string
): Promise<void> {
  await apiClient.delete(`/campaigns/${campaignId}/leads/${leadId}`);
}

/**
 * Get lead activities
 */
export async function getCampaignLeadActivities(
  campaignLeadId: string
): Promise<CampaignLeadActivity[]> {
  const response = await apiClient.get<{ data: CampaignLeadActivity[] }>(
    `/campaigns/leads/${campaignLeadId}/activities`
  );
  return response.data;
}

/**
 * Execute campaign
 */
export async function executeCampaign(
  campaignId: string,
  options?: { leadIds?: string[] }
): Promise<{ success: boolean; executed: number }> {
  const response = await apiClient.post<{ data: { success: boolean; executed: number } }>(
    `/campaigns/${campaignId}/execute`,
    options || {}
  );
  return response.data;
}

/**
 * Get campaign statistics
 */
export async function getCampaignStats(): Promise<CampaignStats> {
  const response = await apiClient.get<{ data: CampaignStats }>('/campaigns/stats');
  return response.data;
}
