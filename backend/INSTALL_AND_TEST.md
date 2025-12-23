# Installation and Testing Guide

## Step 1: Install Dependencies

```powershell
cd lad-feature-campaigns/backend
npm install jsonwebtoken dotenv
```

Or if you want to install all dependencies:
```powershell
npm install
```

## Step 2: Fix Database Connection

The models have been updated to use:
```javascript
const { pool } = require('../../../shared/database/connection');
```

Make sure this path exists in your main backend structure.

## Step 3: Start Test Server

```powershell
# Terminal 1: Start server
cd lad-feature-campaigns/backend
node test-server.js
```

Server will start on port 3000 (or PORT from env).

## Step 4: Run Tests

```powershell
# Terminal 2: Run tests
cd lad-feature-campaigns/backend
node test-endpoints.js
```

## Troubleshooting

### Missing jsonwebtoken
```powershell
npm install jsonwebtoken
```

### Missing dotenv
```powershell
npm install dotenv
```

### Database connection error
- Check if `shared/database/connection.js` exists in your main backend
- Or create a mock connection for testing

### Port already in use
- Change PORT in .env
- Or kill the process using the port

