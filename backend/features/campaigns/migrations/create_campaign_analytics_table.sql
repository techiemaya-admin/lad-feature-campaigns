-- Campaign Analytics Table
-- Stores all campaign activity for real-time tracking

CREATE TABLE IF NOT EXISTS lad_dev.campaign_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES lad_dev.campaigns(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES lad_dev.leads(id) ON DELETE SET NULL,
    
    -- Activity details
    action_type VARCHAR(50) NOT NULL, -- CONNECTION_SENT, MESSAGE_SENT, REPLY_RECEIVED, etc.
    platform VARCHAR(20) NOT NULL, -- linkedin, email, whatsapp, voice, instagram
    status VARCHAR(20) DEFAULT 'success', -- success, failed, pending
    
    -- Lead information
    lead_name VARCHAR(255),
    lead_phone VARCHAR(50),
    lead_email VARCHAR(255),
    
    -- Activity metadata
    message_content TEXT,
    error_message TEXT,
    response_data JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for performance
    CONSTRAINT campaign_analytics_campaign_id_idx 
        FOREIGN KEY (campaign_id) REFERENCES lad_dev.campaigns(id)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_campaign_id 
    ON lad_dev.campaign_analytics(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_created_at 
    ON lad_dev.campaign_analytics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_action_type 
    ON lad_dev.campaign_analytics(action_type);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_platform 
    ON lad_dev.campaign_analytics(platform);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_status 
    ON lad_dev.campaign_analytics(status);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_campaign_analytics_campaign_created 
    ON lad_dev.campaign_analytics(campaign_id, created_at DESC);

-- Add comment
COMMENT ON TABLE lad_dev.campaign_analytics IS 'Real-time campaign activity tracking for live analytics dashboard';
