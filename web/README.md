# Campaigns Feature Test UI

A minimal React application for testing the campaigns feature backend and SDK.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app runs on http://localhost:3001

## Prerequisites

Make sure the backend is running:
```bash
cd ../backend
npm start
```

Backend should be running on http://localhost:3000

## What This Tests

- Backend health check
- API connectivity
- Basic campaign listing
- Error handling

## Architecture

- **Framework**: Vite + React
- **Port**: 3001
- **API Proxy**: Proxies `/api/*` to `http://localhost:3000`

## Note

This is a minimal test UI for standalone feature development. For full integration testing with the LAD application, use the sandbox setup with LAD root.
