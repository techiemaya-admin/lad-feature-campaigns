# LAD Feature: Campaigns

Multi-channel campaign management system with automated workflow execution.

## 📋 Overview

The Campaigns feature provides a complete campaign management system that supports:
- Multi-channel campaigns (Email, SMS, Voice, LinkedIn)
- Automated workflow execution with conditional logic
- Lead tracking and activity monitoring
- Step-by-step campaign execution
- Real-time status updates

## 🏗️ Architecture

### MVC Structure
```
lad-feature-campaigns/
├── controllers/
│   └── CampaignController.js      # Request handling, business logic
├── models/
│   ├── CampaignModel.js           # Campaign CRUD operations
│   ├── CampaignLeadModel.js       # Lead assignment and tracking
│   ├── CampaignStepModel.js       # Campaign step management
│   └── CampaignLeadActivityModel.js # Activity logging
├── middleware/
│   └── validation.js              # Request validation
├── routes/
│   └── index.js                   # Route definitions
├── services/
│   ├── CampaignExecutionService.js # Campaign execution logic
│   └── unipileService.js          # External integration
├── engine/
│   ├── workflowEngine.js          # Workflow orchestration
│   ├── stepExecutor.js            # Step execution
│   ├── conditionEvaluator.js      # Conditional logic
│   └── channelDispatchers/
│       ├── email.js               # Email channel
│       ├── voice.js               # Voice channel
│       └── linkedin.js            # LinkedIn channel
└── manifest.js                     # Feature configuration
```

## ✨ Features

### Campaign Management
- **Create Campaigns**: Define multi-step, multi-channel campaigns
- **Campaign Types**: Email, SMS, Voice, LinkedIn, Multi-channel
- **Status Management**: Draft, Active, Paused, Completed, Archived
- **Lead Assignment**: Add leads to campaigns with tracking

### Workflow Engine
- **Sequential Execution**: Steps execute in defined order
- **Conditional Logic**: Dynamic branching based on conditions
- **Channel Dispatchers**: Dedicated handlers for each communication channel
- **Error Handling**: Retry logic and error recovery

### Lead Tracking
- **Activity Logging**: Track all interactions and outcomes
- **Status Updates**: Real-time lead status in campaigns
- **Performance Metrics**: Campaign effectiveness tracking

## 🔌 API Endpoints

### Campaign Operations
```
POST   /api/campaigns                  # Create campaign
GET    /api/campaigns                  # List campaigns
GET    /api/campaigns/:id              # Get campaign details
PUT    /api/campaigns/:id              # Update campaign
DELETE /api/campaigns/:id              # Delete campaign
POST   /api/campaigns/:id/activate     # Activate campaign
POST   /api/campaigns/:id/pause        # Pause campaign
POST   /api/campaigns/:id/archive      # Archive campaign
```

### Lead Management
```
POST   /api/campaigns/:id/leads        # Add leads to campaign
GET    /api/campaigns/:id/leads        # Get campaign leads
DELETE /api/campaigns/:id/leads/:leadId # Remove lead from campaign
```

### Execution
```
POST   /api/campaigns/:id/execute      # Execute campaign
GET    /api/campaigns/:id/stats        # Get campaign statistics
```

## 📊 Database Schema

### Tables
- `campaigns` - Campaign definitions
- `campaign_steps` - Campaign workflow steps
- `campaign_leads` - Lead assignments to campaigns
- `campaign_lead_activities` - Activity tracking

### Key Fields

**campaigns**
- `id`, `name`, `description`, `type`, `status`
- `organization_id`, `user_id`
- `settings` (JSONB), `created_at`, `updated_at`

**campaign_steps**
- `id`, `campaign_id`, `step_order`, `step_type`
- `channel`, `content` (JSONB), `conditions` (JSONB)
- `delay_minutes`, `is_active`

**campaign_leads**
- `id`, `campaign_id`, `lead_id`
- `status`, `current_step`, `last_contact_at`
- `completed_at`, `metadata` (JSONB)

**campaign_lead_activities**
- `id`, `campaign_lead_id`, `campaign_step_id`
- `activity_type`, `channel`, `status`
- `metadata` (JSONB), `created_at`

## 🔧 Configuration

### Manifest
```javascript
{
  key: 'campaigns',
  name: 'Campaigns',
  version: '2.0.0',
  plans: ['professional', 'enterprise'],
  alwaysAvailable: true
}
```

### Credits
- No per-operation credits (included in plan)
- Channel-specific costs may apply (Voice, LinkedIn)

## 🚀 Usage

### Creating a Campaign
```javascript
POST /api/campaigns
{
  "name": "Q1 Outreach",
  "description": "Enterprise lead outreach",
  "type": "multi-channel",
  "steps": [
    {
      "step_order": 1,
      "step_type": "send",
      "channel": "email",
      "content": {
        "subject": "Introduction",
        "body": "Hello {{name}}..."
      }
    },
    {
      "step_order": 2,
      "step_type": "wait",
      "delay_minutes": 2880
    },
    {
      "step_order": 3,
      "step_type": "send",
      "channel": "linkedin",
      "content": {
        "message": "Following up on email..."
      }
    }
  ]
}
```

### Adding Leads
```javascript
POST /api/campaigns/:id/leads
{
  "leadIds": [123, 456, 789]
}
```

### Executing Campaign
```javascript
POST /api/campaigns/:id/execute
{
  "leadIds": [123, 456] // Optional, execute for specific leads
}
```

## 🔄 Workflow Engine

### Execution Flow
1. **Initialization**: Load campaign and leads
2. **Step Execution**: Process each step sequentially
3. **Condition Evaluation**: Check branching conditions
4. **Channel Dispatch**: Send via appropriate channel
5. **Activity Logging**: Record all actions
6. **Status Update**: Update lead progress

### Conditional Logic
```javascript
{
  "conditions": {
    "type": "and",
    "rules": [
      {
        "field": "lead.industry",
        "operator": "equals",
        "value": "Technology"
      },
      {
        "field": "lead.employee_count",
        "operator": "greater_than",
        "value": 100
      }
    ]
  }
}
```

## 🧪 Testing

### Local Testing
```bash
# Start server
cd LAD/backend
npm start

# Test endpoints
curl -X POST http://localhost:3004/api/campaigns \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Campaign", "type": "email"}'
```

### Validation Testing
```bash
# Test campaign creation validation
curl -X POST http://localhost:3004/api/campaigns \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "invalid"}'
# Should return: 400 Bad Request - Invalid campaign type
```

## 📦 Dependencies

### Internal
- `core/database` - Database connection
- `core/billing` - Credit management
- `shared/middleware` - Authentication

### External
- `pg` - PostgreSQL client
- `axios` - HTTP requests (for external APIs)

## 🔐 Security

### Access Control
- Organization-scoped data (multi-tenant isolation)
- User-level permissions
- JWT authentication required

### Validation
- Campaign type validation
- Status validation
- Lead ID validation
- Content validation per channel

## 📈 Performance

### Optimizations
- Batch lead processing
- Async workflow execution
- Channel-specific rate limiting
- Database query optimization with indexes

### Monitoring
- Campaign execution metrics
- Lead conversion tracking
- Channel performance analytics
- Error rate monitoring

## 🐛 Known Issues

None currently reported.

## 📝 Changelog

### Version 2.0.0 (December 22, 2025)
- ✅ Refactored to MVC architecture
- ✅ Added middleware/validation.js
- ✅ Converted routes.js to routes/index.js
- ✅ Improved workflow engine
- ✅ Enhanced error handling

### Version 1.0.0
- Initial release
- Basic campaign management
- Email and voice channels

## 🤝 Contributing

This feature follows the LAD architecture standards:
- MVC pattern with clear separation of concerns
- Validation middleware for all endpoints
- Models for database operations
- Controllers for business logic
- Services for external integrations

## 📄 License

Proprietary - LAD Platform

## 👥 Maintainers

- LAD Backend Team

---

**Status:** ✅ Production Ready  
**Last Updated:** December 22, 2025
