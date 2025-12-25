# Campaigns Feature - Complete Testing Suite

## Two Test Scripts Available:

### 1. `test-endpoints.js` - Endpoint Testing
Tests all endpoints and **verifies data is saved/updated in the database**.

### 2. `test-workflow.js` - Complete Workflow Testing
Tests the **full campaign workflow**: Create → Generate Leads → Execute All Steps

## 🚀 Quick Start

### 1. Install
```bash
npm install
```

### 2. Get Token
From browser DevTools → Network → Headers → `Authorization: Bearer <token>`

### 3. Run Tests
```bash
# With token
node test-endpoints.js YOUR_TOKEN

# Or save token first
echo "YOUR_TOKEN" > .token
node test-endpoints.js
```

## ✅ What Gets Tested

Each test **verifies database persistence**:

1. **Create Campaign** → Verifies it's saved in database
2. **Update Campaign** → Verifies changes are saved
3. **Update Steps** → Verifies steps are saved
4. **Start Campaign** → Verifies status changes
5. **Delete Campaign** → Verifies it's removed

Plus all other endpoints with full validation.

## 📋 Test Flow

```
1. List campaigns
2. Get stats
3. Create campaign → ✅ Verify saved in DB
4. Get campaign by ID
5. Update campaign → ✅ Verify changes saved in DB
6. Get steps
7. Update steps → ✅ Verify steps saved in DB
8. Get leads
9. Start campaign → ✅ Verify status changed
10. Pause campaign
11. Stop campaign
12. Get analytics
13. Get activities
14. Delete campaign → ✅ Verify removed from DB
```

## 🔧 Test Options

### Endpoint Tests
```bash
# Run endpoint tests
node test-endpoints.js YOUR_TOKEN

# Auto-delete test campaign
DELETE_TEST_CAMPAIGN=true node test-endpoints.js YOUR_TOKEN
```

### Workflow Tests (Full Flow)
```bash
# Test complete workflow: Create → Generate Leads → Execute Steps
node test-workflow.js YOUR_TOKEN

# Or using npm
npm run test:workflow YOUR_TOKEN
```

## 📋 Workflow Test Includes:

1. **Create Campaign** with lead generation filters (job titles, industries, locations)
2. **Verify Filters** are saved correctly
3. **Start Campaign** (triggers lead generation from Apollo/database)
4. **Verify Leads Generated** (checks if Apollo/database was called)
5. **Check Activities** (verifies steps are executing)
6. **Verify Step Execution** (checks each step in workflow)
7. **Check Lead Progression** (tracks lead status through steps)
8. **Get Analytics** (overall campaign progress)

## 📊 Expected Output

Each test shows:
- ✅ Pass/fail status
- 📝 Data retrieved from database
- 🔍 Verification that changes are persisted

---

**This tests the FULL flow including database persistence!**

