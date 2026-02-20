-- Migration: Add LinkedIn connection tracking columns to campaign_analytics
-- Date: 2026-02-10
-- Purpose: Track CONNECTION_ACCEPTED events with account and lead details
-- Repository: https://github.com/techiemaya-admin/lad-feature-campaigns
-- Branch: feature/linkedin-polling-connection-tracking

-- Add columns for LinkedIn connection tracking
ALTER TABLE campaign_analytics
ADD COLUMN IF NOT EXISTS account_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS provider_account_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS lead_linkedin TEXT;

-- Add index for faster lookups by account
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_provider_account 
ON campaign_analytics(tenant_id, provider_account_id, action_type);

-- Add index for faster lookups by LinkedIn URL
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_lead_linkedin 
ON campaign_analytics(tenant_id, lead_linkedin, action_type);

-- Add comment explaining the columns
COMMENT ON COLUMN campaign_analytics.account_name IS 'Name of LinkedIn account that performed the action';
COMMENT ON COLUMN campaign_analytics.provider_account_id IS 'Unipile provider account ID (unipile_account_id)';
COMMENT ON COLUMN campaign_analytics.lead_linkedin IS 'LinkedIn URL of the lead/connection';

-- Verify the structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'campaign_analytics'
  AND column_name IN ('account_name', 'provider_account_id', 'lead_linkedin')
ORDER BY ordinal_position;
