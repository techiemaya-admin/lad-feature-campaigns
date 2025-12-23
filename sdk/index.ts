/**
 * Campaigns SDK
 * 
 * Main export file for the Campaigns feature SDK
 */

// Types
export type {
  Campaign,
  CampaignStep,
  CampaignLead,
  CampaignLeadActivity,
  CampaignStats,
  CampaignType,
  CampaignStatus,
  StepType,
  Channel,
  CampaignCreateInput,
  CampaignUpdateInput,
  AddLeadsInput,
  CampaignListParams,
} from './types';

// API Functions
export {
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
  getCampaignLeadActivities,
  executeCampaign,
  getCampaignStats,
} from './api';

// Hooks
export {
  useCampaigns,
  useCampaign,
  useCampaignSteps,
  useCampaignLeads,
  useCampaignStats,
} from './hooks';
