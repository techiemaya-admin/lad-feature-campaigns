# LAD Feature - Campaigns Backend

This is a feature module for the Lead Assistant Dashboard (LAD) campaign management system.

## Architecture

This module follows the **LAD Microservice Architecture** and is designed to be integrated into the parent STS (Salesmaya Tech Suite) service.

### Directory Structure

```
latest-campaign-backend/
├── backend/
│   └── features/
│       └── campaigns/          # Campaign feature module
│           ├── controllers/     # Request handlers
│           ├── models/          # Database models
│           ├── services/        # Business logic
│           ├── repositories/    # Data access layer
│           ├── routes/          # API routes
│           ├── engine/          # Workflow execution engine
│           ├── middleware/      # Feature-specific middleware
│           ├── migrations/      # Database migrations
│           ├── constants.js     # Feature constants
│           ├── index.js         # Feature entry point
│           └── manifest.js      # Feature manifest
├── frontend/
│   └── sdk/
│       └── features/
│           └── campaigns/       # Frontend SDK for campaigns
│               ├── hooks/       # React hooks
│               ├── api.ts       # API client
│               ├── types.ts     # TypeScript types
│               └── index.ts     # SDK entry point
└── shared/                      # Shared utilities (local dev only)

```

## Dependencies

### Production Dependencies (Provided by STS Service)

The following modules are **NOT included** in this repository as they are provided by the parent STS service:

- `backend/core/utils/logger` - Logging utility
- `backend/core/utils/schemaHelper` - Multi-tenant schema helper
- `sts-service/src/config/postgres` - Database connection pool

### Local Development

For local development, the following files are provided but **NOT committed to production**:

- `backend/core/` - Core utilities (gitignored)
- `shared/database/connection.js` - Database connection with fallback
- All `test-*.js`, `check-*.js` files - Testing scripts (gitignored)

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=salesmaya_agent
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_SCHEMA=lad_dev
PORT=3002
NODE_ENV=development
JWT_SECRET=your-jwt-secret
```

## Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Access to LAD database schema

### Setup

1. Install dependencies (if testing locally):
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run local development server:
```bash
node test-server.js
```

## Production Deployment

This module is designed to be deployed as part of the STS service ecosystem.

### What Gets Deployed

Only the following directories are included in production:
- `backend/features/campaigns/` - Campaign feature code
- `frontend/sdk/features/campaigns/` - Frontend SDK

### What's Excluded (Gitignored)

- `backend/core/` - Provided by STS service
- `shared/` - Provided by STS service  
- All test files (`test-*.js`, `check-*.js`)
- Documentation files (`.md`)
- Local configuration (`.env`)

## Features

### Campaign Types
- **Outbound Campaigns** - Apollo API lead generation with LinkedIn/Email outreach
- **Inbound Campaigns** - CSV upload with manual lead processing

### Workflow Engine
- Multi-step campaign execution
- Conditional logic and delays
- Multi-channel support (LinkedIn, Email, WhatsApp, Voice)
- Real-time campaign analytics

### LinkedIn Integration
- Unipile integration for LinkedIn automation
- Connection requests and messaging
- Profile enrichment
- Account management

## API Endpoints

See campaign routes in `backend/features/campaigns/routes/` for available endpoints.

## Database Schema

Database tables are managed under the `lad_dev` schema (or configured `DB_SCHEMA`).

Key tables:
- `campaigns` - Campaign definitions
- `campaign_steps` - Workflow steps
- `campaign_leads` - Lead assignment and tracking
- `campaign_lead_activities` - Activity history
- `leads` - Lead database (for inbound campaigns)

## Support

For issues or questions, contact the LAD development team.
