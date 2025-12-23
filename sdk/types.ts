/**
 * Campaign Types
 * 
 * Type definitions for the Campaigns feature SDK
 */

export type CampaignType = 'email' | 'voice' | 'linkedin' | 'sms' | 'multi-channel';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type StepType = 'send' | 'wait' | 'condition';
export type Channel = 'email' | 'voice' | 'linkedin' | 'sms';

export interface Campaign {
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

export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  step_type: StepType;
  channel?: Channel;
  content?: {
    subject?: string;
    body?: string;
    message?: string;
    template_id?: string;
  };
  conditions?: {
    type: 'and' | 'or';
    rules: Array<{
      field: string;
      operator: string;
      value: any;
    }>;
  };
  delay_minutes?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  current_step?: number;
  last_contact_at?: string;
  completed_at?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CampaignLeadActivity {
  id: string;
  campaign_lead_id: string;
  campaign_step_id: string;
  activity_type: 'email_sent' | 'email_opened' | 'email_clicked' | 'linkedin_sent' | 'voice_called' | 'sms_sent' | 'replied';
  channel: Channel;
  status: 'success' | 'failed' | 'pending';
  metadata?: Record<string, any>;
  created_at: string;
}

export interface CampaignStats {
  total_campaigns: number;
  active_campaigns: number;
  total_leads: number;
  total_sent: number;
  total_delivered: number;
  total_connected: number;
  total_replied: number;
  avg_connection_rate: number;
  avg_reply_rate: number;
}

export interface CampaignCreateInput {
  name: string;
  description?: string;
  type: CampaignType;
  settings?: Record<string, any>;
  steps?: Omit<CampaignStep, 'id' | 'campaign_id' | 'created_at' | 'updated_at'>[];
}

export interface CampaignUpdateInput {
  name?: string;
  description?: string;
  type?: CampaignType;
  settings?: Record<string, any>;
}

export interface AddLeadsInput {
  leadIds: string[];
}

export interface CampaignListParams {
  status?: CampaignStatus;
  type?: CampaignType;
  search?: string;
  page?: number;
  limit?: number;
}
