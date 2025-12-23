# Local Testing Guide for Campaigns Feature

This guide explains how to test the campaigns feature standalone (outside the main LAD repo).

## Setup for Local Testing

### Files for Local Testing Only
These files are **NOT synced** to the main LAD repo:

- `backend/.env` - Local environment variables
- `backend/middleware/auth.js` - Local JWT authentication middleware
- `backend/generate-token.js` - Token generation script
- `backend/package.json` - Local dependencies
- `backend/package-lock.json` - Lock file

### Installation

```bash
cd backend
npm install
```

### Configuration

The `.env` file is already configured with test values. No changes needed.

### Generate Test JWT Token

```bash
node generate-token.js
```

This will output a JWT token valid for 7 days with test user credentials.

### Using the Token

Add the token to your API requests:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  http://localhost:3000/api/campaigns
```

## Important Notes

1. **Never commit** the local testing files to git (they're in `.gitignore`)
2. **When syncing** to main LAD repo:
   - The main repo's auth middleware will be used
   - The main repo's `.env` will be used
   - These local files are automatically excluded

## Main Repo Integration

When this feature is synced to the main LAD-Backend repo:
- Routes will use: `../../../middleware/auth` (LAD's main auth)
- Environment variables from LAD's main `.env`
- Database connection from LAD's main configuration
