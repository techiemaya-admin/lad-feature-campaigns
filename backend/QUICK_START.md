# Quick Start - Testing Endpoints

## ✅ Dependencies Installed

The required packages (`jsonwebtoken`, `dotenv`) have been installed.

## 🔧 Fixed Issues

1. ✅ Added `jsonwebtoken` and `dotenv` to package.json
2. ✅ Fixed database imports in all models (using `pool` from `shared/database/connection`)
3. ✅ Created comprehensive test script

## 🚀 How to Test

### Option 1: Test with Mock Database (Easiest)

The test server uses mock auth, so database errors won't block route testing:

```powershell
# Terminal 1: Start test server
cd D:\techiemaya\lad-feature-campaigns\backend
node test-server.js
```

```powershell
# Terminal 2: Run tests
cd D:\techiemaya\lad-feature-campaigns\backend
node test-endpoints.js
```

### Option 2: Test with Real Database

If you have the database connection set up:

1. Make sure `shared/database/connection.js` exists in your main backend
2. Start your main server (not test-server.js)
3. Run `node test-endpoints.js`

## 📝 What the Test Script Does

- ✅ Generates JWT token automatically
- ✅ Tests all 30 endpoints
- ✅ Handles validation requirements
- ✅ Shows detailed results
- ✅ Tests error cases

## 🎯 Expected Results

- **Passed**: Endpoints that work correctly
- **Failed**: Endpoints with errors (connection, database, etc.)
- **Skipped**: Endpoints that require data that doesn't exist (normal)

## 💡 Tips

- The test server uses **mock authentication** (no real JWT needed)
- Database operations will fail without proper DB connection (expected)
- LinkedIn endpoints require Unipile configuration
- Some endpoints are skipped if required data doesn't exist

## 🔍 Testing Individual Endpoints

You can also test manually:

```powershell
# Generate token
node generate-token.js

# Use token in requests
$token = "your_generated_token"
$headers = @{ "Authorization" = "Bearer $token" }
Invoke-WebRequest -Uri "http://localhost:3000/api/campaigns" -Headers $headers
```

