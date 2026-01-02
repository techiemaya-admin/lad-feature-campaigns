# Campaigns Feature

## Overview
The Campaigns feature manages multi-channel outreach campaigns with LinkedIn automation, lead management, and campaign orchestration.

## Architecture

### Controllers
- **CampaignController.js** - Main campaign CRUD operations
- **CampaignCRUDController.js** - Extended CRUD functionality
- **CampaignActionsController.js** - Campaign actions (start, pause, resume)
- **CampaignStepsController.js** - Campaign step management
- **CampaignLeadsController.js** - Lead assignment and management
- **CampaignLeadsRevealController.js** - Lead reveal functionality
- **CampaignLeadsSummaryController.js** - Lead analytics and summaries
- **LinkedInController.js** - LinkedIn integration
- **LinkedInAccountController.js** - LinkedIn account management
- **LinkedInAuthController.js** - LinkedIn authentication
- **LinkedInCheckpointController.js** - LinkedIn checkpoint handling
- **LinkedInWebhookController.js** - LinkedIn webhook handlers

### Services
Business logic layer for campaign processing, LinkedIn automation, lead management, and multi-step campaign execution.

### Models
Database models for campaigns, campaign steps, leads, LinkedIn accounts, and related entities.

### Routes
- **index.js** - Main campaign routes
- **linkedin.js** - LinkedIn-specific routes

### Middleware
- **validation.js** - Request validation middleware

### Engine
Campaign execution engine for processing multi-step campaigns with scheduling and automation.

### Repositories
Data access layer for database operations.

## Environment Variables
```env
DB_HOST=your_database_host
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_SCHEMA=public

LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT_URI=your_redirect_uri

APOLLO_LEADS_SERVICE_URL=http://apollo-leads-service
CAMPAIGN_SERVICE_URL=http://campaigns-service
```

## API Endpoints

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/:id` - Get campaign details
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign
- `POST /api/campaigns/:id/start` - Start campaign
- `POST /api/campaigns/:id/pause` - Pause campaign

### LinkedIn
- `POST /api/linkedin/auth` - LinkedIn OAuth
- `GET /api/linkedin/accounts` - List LinkedIn accounts
- `POST /api/linkedin/checkpoint` - Handle checkpoint

## Testing
```bash
npm test
npm start  # Runs test-server.js for local development
```

## Dependencies
- Express.js
- PostgreSQL
- LinkedIn OAuth
- Apollo Leads Service
