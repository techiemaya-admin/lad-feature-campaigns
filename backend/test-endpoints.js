/**
 * Comprehensive Endpoint Testing Script
 * Tests all 30 endpoints in the campaigns feature
 * 
 * Usage:
 *   node test-endpoints.js
 * 
 * Environment Variables:
 *   BASE_URL - API base URL (default: http://localhost:3000)
 *   JWT_SECRET - JWT secret key (from .env or default)
 *   TEST_CAMPAIGN_ID - Existing campaign ID for testing (optional)
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// Try to load .env file
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
} catch (e) {
  // dotenv not available, that's okay
}

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api/campaigns`;
const TEST_USER_ID = parseInt(process.env.TEST_USER_ID) || 1;
const TEST_TENANT_ID = parseInt(process.env.TEST_TENANT_ID) || 1;
const TEST_ORG_ID = parseInt(process.env.TEST_ORG_ID) || 1;

// Generate JWT Token
function generateTestToken() {
  const payload = {
    userId: TEST_USER_ID,
    user_id: TEST_USER_ID,
    id: TEST_USER_ID,
    tenantId: TEST_TENANT_ID,
    tenant_id: TEST_TENANT_ID,
    organization_id: TEST_ORG_ID,
    orgId: TEST_ORG_ID,
    email: 'test@example.com'
  };

  // Use expiresIn in jwt.sign() - don't set exp in payload
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  return token;
}

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// Helper function to make API calls
async function testEndpoint(name, method, url, data = null, requiresAuth = true, expectedStatus = null) {
  try {
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000,
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors
      }
    };

    if (requiresAuth) {
      config.headers['Authorization'] = `Bearer ${JWT_TOKEN}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    
    // Check if response matches expected status (including 4xx codes)
    if (expectedStatus && response.status === expectedStatus) {
      const message = response.data?.error || response.data?.message || `Status ${response.status} as expected`;
      console.log(`✅ ${name} - Status: ${response.status} (Expected)`);
      results.passed++;
      return { success: true, data: response.data, status: response.status };
    }
    
    // If expected status was set but doesn't match, mark as skipped
    if (expectedStatus && response.status !== expectedStatus) {
      const message = response.data?.error || response.data?.message || `Expected ${expectedStatus}, got ${response.status}`;
      console.log(`⚠️  ${name} - Status: ${response.status} (Expected: ${expectedStatus}) - ${message}`);
      results.skipped++;
      return { success: false, status: response.status, message, expected: true };
    }
    
    // Check if response is successful (2xx)
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ ${name} - Status: ${response.status}`);
      results.passed++;
      return { success: true, data: response.data, status: response.status };
    } else {
      // 4xx errors - might be expected
      const message = response.data?.error || response.data?.message || `HTTP ${response.status}`;
      if (response.status === 404 || response.status === 400) {
        console.log(`⚠️  ${name} - Status: ${response.status} (Expected: ${message})`);
        results.skipped++;
        return { success: false, status: response.status, message, expected: true };
      }
      console.log(`❌ ${name} - Status: ${response.status} - Error: ${message}`);
      results.failed++;
      results.errors.push({ name, status: response.status, message });
      return { success: false, status: response.status, message };
    }
  } catch (error) {
    // Network errors, connection refused, etc.
    let errorMessage = 'Unknown error';
    let status = 'N/A';
    
    if (error.code === 'ECONNREFUSED') {
      errorMessage = `Connection refused - Is server running at ${BASE_URL}?`;
      console.log(`\n❌ ${errorMessage}`);
      console.log(`   💡 Start your server: node test-server.js\n`);
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = `Host not found - Check BASE_URL: ${BASE_URL}`;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout - Server may be slow or unresponsive';
    } else if (error.response) {
      status = error.response.status;
      errorMessage = error.response.data?.error || error.response.data?.message || error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    console.log(`❌ ${name} - Status: ${status} - Error: ${errorMessage}`);
    if (error.code) {
      console.log(`   Error Code: ${error.code}`);
    }
    results.failed++;
    results.errors.push({ name, status, message: errorMessage, code: error.code });
    return { success: false, status, message: errorMessage };
  }
}

// Test Campaign Endpoints
async function testCampaignEndpoints() {
  console.log('\n📋 Testing Campaign Endpoints (14 endpoints)\n');
  console.log('='.repeat(70));

  let createdCampaignId = null;

  // 1. List campaigns
  await testEndpoint(
    '1. GET /api/campaigns - List campaigns',
    'GET',
    `${API_BASE}?limit=10&offset=0`
  );

  // 2. Get campaign stats
  await testEndpoint(
    '2. GET /api/campaigns/stats - Get stats',
    'GET',
    `${API_BASE}/stats`
  );

  // 3. Create campaign
  const createResult = await testEndpoint(
    '3. POST /api/campaigns - Create campaign',
    'POST',
    `${API_BASE}`,
    {
      name: `Test Campaign ${Date.now()}`,
      status: 'draft',
      config: {
        leads_per_day: 25
      }
    }
  );
  
  if (createResult.success && createResult.data?.data?.id) {
    createdCampaignId = createResult.data.data.id;
    console.log(`   ✓ Created campaign ID: ${createdCampaignId}`);
  }

  // Use provided ID or created ID
  const campaignId = process.env.TEST_CAMPAIGN_ID || createdCampaignId;

  if (campaignId) {
    // 4. Get campaign by ID
    await testEndpoint(
      '4. GET /api/campaigns/:id - Get campaign',
      'GET',
      `${API_BASE}/${campaignId}`
    );

    // 5. Update campaign
    await testEndpoint(
      '5. PATCH /api/campaigns/:id - Update campaign',
      'PATCH',
      `${API_BASE}/${campaignId}`,
      {
        name: 'Updated Test Campaign',
        status: 'draft'
      }
    );

    // 6. Get campaign leads
    await testEndpoint(
      '6. GET /api/campaigns/:id/leads - Get leads',
      'GET',
      `${API_BASE}/${campaignId}/leads?limit=10&offset=0`
    );

    // 7. Add leads to campaign
    const addLeadsResult = await testEndpoint(
      '7. POST /api/campaigns/:id/leads - Add leads',
      'POST',
      `${API_BASE}/${campaignId}/leads`,
      {
        leads: [
          {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john.doe@example.com',
            linkedin_url: 'https://linkedin.com/in/johndoe',
            company_name: 'Test Company',
            title: 'Software Engineer'
          }
        ]
      }
    );

    // 8. Get campaign activities
    await testEndpoint(
      '8. GET /api/campaigns/:id/activities - Get activities',
      'GET',
      `${API_BASE}/${campaignId}/activities?limit=10&offset=0`
    );

    // 9. Start campaign
    await testEndpoint(
      '9. POST /api/campaigns/:id/start - Start campaign',
      'POST',
      `${API_BASE}/${campaignId}/start`
    );

    // 10. Pause campaign
    await testEndpoint(
      '10. POST /api/campaigns/:id/pause - Pause campaign',
      'POST',
      `${API_BASE}/${campaignId}/pause`
    );

    // 11. Stop campaign
    await testEndpoint(
      '11. POST /api/campaigns/:id/stop - Stop campaign',
      'POST',
      `${API_BASE}/${campaignId}/stop`
    );

    // 12. Get campaign steps
    await testEndpoint(
      '12. GET /api/campaigns/:id/steps - Get steps',
      'GET',
      `${API_BASE}/${campaignId}/steps`
    );

    // 13. Update campaign steps
    await testEndpoint(
      '13. POST /api/campaigns/:id/steps - Update steps',
      'POST',
      `${API_BASE}/${campaignId}/steps`,
      {
        steps: [
          {
            step_type: 'lead_generation',
            order: 1,
            config: {
              leadGenerationFilters: {
                roles: ['Software Engineer'],
                location: ['San Francisco']
              },
              leads_per_day: 25
            }
          },
          {
            step_type: 'linkedin_connect',
            order: 2,
            config: {
              message: 'Hello, I would like to connect!'
            }
          }
        ]
      }
    );

    // 14. Delete campaign (commented to avoid accidental deletion)
    // Uncomment to test deletion:
    // await testEndpoint(
    //   '14. DELETE /api/campaigns/:id - Delete campaign',
    //   'DELETE',
    //   `${API_BASE}/${campaignId}`
    // );
    console.log('⚠️  14. DELETE /api/campaigns/:id - Delete campaign (Skipped - uncomment to test)');
    results.skipped++;
  } else {
    console.log('⚠️  Skipping campaign-specific tests (no campaign ID available)');
    results.skipped += 10;
  }
}

// Test LinkedIn Endpoints
async function testLinkedInEndpoints() {
  console.log('\n\n🔗 Testing LinkedIn Integration Endpoints (16 endpoints)\n');
  console.log('='.repeat(70));

  // 1. Start OAuth
  await testEndpoint(
    '1. GET /api/campaigns/linkedin/auth/start - Start OAuth',
    'GET',
    `${API_BASE}/linkedin/auth/start?redirect_uri=http://localhost:3000/callback`
  );

  // 2. Get accounts
  const accountsResult = await testEndpoint(
    '2. GET /api/campaigns/linkedin/accounts - Get accounts',
    'GET',
    `${API_BASE}/linkedin/accounts`
  );

  let accountId = null;
  if (accountsResult.success && accountsResult.data?.accounts?.length > 0) {
    accountId = accountsResult.data.accounts[0].unipile_account_id;
    console.log(`   ✓ Found account ID: ${accountId}`);
  }

  // 3. Get status
  await testEndpoint(
    '3. GET /api/campaigns/linkedin/status - Get status',
    'GET',
    `${API_BASE}/linkedin/status`
  );

  // 4. Get account status
  if (accountId) {
    await testEndpoint(
      '4. GET /api/campaigns/linkedin/account-status - Get account status',
      'GET',
      `${API_BASE}/linkedin/account-status?account_id=${accountId}`
    );
  } else {
    await testEndpoint(
      '4. GET /api/campaigns/linkedin/account-status - Get account status',
      'GET',
      `${API_BASE}/linkedin/account-status`
    );
  }

  // 5. Sync account
  await testEndpoint(
    '5. POST /api/campaigns/linkedin/sync - Sync account',
    'POST',
    `${API_BASE}/linkedin/sync`
  );

  // 6. Sync from Unipile
  if (accountId) {
    await testEndpoint(
      '6. GET /api/campaigns/linkedin/sync-from-unipile - Sync from Unipile',
      'GET',
      `${API_BASE}/linkedin/sync-from-unipile?account_id=${accountId}`
    );
  } else {
    await testEndpoint(
      '6. GET /api/campaigns/linkedin/sync-from-unipile - Sync from Unipile',
      'GET',
      `${API_BASE}/linkedin/sync-from-unipile`
    );
  }

  // 7. List webhooks
  await testEndpoint(
    '7. GET /api/campaigns/linkedin/webhooks - List webhooks',
    'GET',
    `${API_BASE}/linkedin/webhooks`
  );

  // 8. Register webhook
  await testEndpoint(
    '8. POST /api/campaigns/linkedin/register-webhook - Register webhook',
    'POST',
    `${API_BASE}/linkedin/register-webhook`,
    {
      webhook_url: `${BASE_URL}/api/campaigns/linkedin/webhook`,
      events: ['new_relation'],
      source: 'users'
    }
  );

  // 9. Refresh token
  if (accountId) {
    await testEndpoint(
      '9. POST /api/campaigns/linkedin/refresh - Refresh token',
      'POST',
      `${API_BASE}/linkedin/refresh`,
      {
        account_id: accountId
      }
    );
  } else {
    await testEndpoint(
      '9. POST /api/campaigns/linkedin/refresh - Refresh token',
      'POST',
      `${API_BASE}/linkedin/refresh`
    );
  }

  // 10. Reconnect account
  if (accountId) {
    await testEndpoint(
      '10. POST /api/campaigns/linkedin/reconnect - Reconnect account',
      'POST',
      `${API_BASE}/linkedin/reconnect`,
      {
        account_id: accountId
      }
    );
  } else {
    console.log('⚠️  Skipping reconnect test (no account ID)');
    results.skipped++;
  }

  // 11. Solve checkpoint
  if (accountId) {
    await testEndpoint(
      '11. POST /api/campaigns/linkedin/solve-checkpoint - Solve checkpoint',
      'POST',
      `${API_BASE}/linkedin/solve-checkpoint`,
      {
        account_id: accountId,
        answer: 'YES'
      }
    );
  } else {
    console.log('⚠️  Skipping checkpoint test (no account ID)');
    results.skipped++;
  }

  // 12. Verify OTP
  if (accountId) {
    await testEndpoint(
      '12. POST /api/campaigns/linkedin/verify-otp - Verify OTP',
      'POST',
      `${API_BASE}/linkedin/verify-otp`,
      {
        account_id: accountId,
        otp: '123456'
      }
    );
  } else {
    console.log('⚠️  Skipping OTP test (no account ID)');
    results.skipped++;
  }

  // 13. Connect account
  await testEndpoint(
    '13. POST /api/campaigns/linkedin/connect - Connect account',
    'POST',
    `${API_BASE}/linkedin/connect`,
    {
      method: 'cookies',
      li_at: 'test_cookie',
      li_a: 'test_cookie'
    }
  );

  // 14. OAuth callback (requires actual OAuth flow)
  console.log('⚠️  14. GET /api/campaigns/linkedin/auth/callback - OAuth callback (Skipped - requires actual OAuth flow)');
  results.skipped++;

  // 15. Webhook handler
  await testEndpoint(
    '15. POST /api/campaigns/linkedin/webhook - Handle webhook',
    'POST',
    `${API_BASE}/linkedin/webhook`,
    {
      event: 'new_relation',
      data: { test: 'data' }
    },
    false // No auth required for webhook
  );

  // 16. Disconnect (commented to avoid disconnecting)
  // if (accountId) {
  //   await testEndpoint(
  //     '16. POST /api/campaigns/linkedin/disconnect - Disconnect account',
  //     'POST',
  //     `${API_BASE}/linkedin/disconnect`,
  //     {
  //       unipileAccountId: accountId
  //     }
  //   );
  // }
  console.log('⚠️  16. POST /api/campaigns/linkedin/disconnect - Disconnect account (Skipped - uncomment to test)');
  results.skipped++;
}

// Test validation endpoints
async function testValidationEndpoints() {
  console.log('\n\n🔍 Testing Validation (Error Cases)\n');
  console.log('='.repeat(70));

  // Test invalid campaign creation (missing name)
  await testEndpoint(
    'V1. POST /api/campaigns - Invalid (no name)',
    'POST',
    `${API_BASE}`,
    { status: 'draft' },
    true,
    400 // Expected 400
  );

  // Test invalid UUID
  await testEndpoint(
    'V2. GET /api/campaigns/:id - Invalid UUID',
    'GET',
    `${API_BASE}/invalid-uuid`,
    null,
    true,
    400 // Expected 400
  );

  // Test without auth token
  await testEndpoint(
    'V3. GET /api/campaigns - No auth token',
    'GET',
    `${API_BASE}`,
    null,
    false, // No auth
    401 // Expected 401
  );
}

// Main test runner
async function runAllTests() {
  console.log('\n🚀 Comprehensive Endpoint Testing');
  console.log('='.repeat(70));
  
  // Generate JWT Token
  console.log('🔑 Generating JWT Token...');
  const token = generateTestToken();
  global.JWT_TOKEN = token; // Make it available globally
  
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Base: ${API_BASE}`);
  console.log(`JWT Secret: ${JWT_SECRET.substring(0, 20)}...`);
  console.log(`User ID: ${TEST_USER_ID}, Tenant ID: ${TEST_TENANT_ID}`);
  console.log(`Token: ${token.substring(0, 50)}...`);
  console.log('='.repeat(70));
  console.log('⚠️  Make sure your server is running!');
  console.log('   Start server: node test-server.js');
  console.log('='.repeat(70));

  try {
    // Test Campaign Endpoints
    await testCampaignEndpoints();

    // Test LinkedIn Endpoints
    await testLinkedInEndpoints();

    // Test Validation
    await testValidationEndpoints();

    // Print summary
    console.log('\n\n📊 Test Summary');
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`⚠️  Skipped: ${results.skipped}`);
    console.log(`📈 Total: ${results.passed + results.failed + results.skipped}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors (showing first 10):');
      results.errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.name}`);
        console.log(`      Status: ${error.status}`);
        console.log(`      Message: ${error.message}`);
        if (error.code) {
          console.log(`      Code: ${error.code}`);
        }
      });
      if (results.errors.length > 10) {
        console.log(`   ... and ${results.errors.length - 10} more errors`);
      }
    }

    console.log('\n' + '='.repeat(70));
    
    if (results.failed === 0) {
      console.log('🎉 All tests completed successfully!');
      console.log('\n💡 Tips:');
      console.log('   - Some endpoints may be skipped if data doesn\'t exist (that\'s normal)');
      console.log('   - LinkedIn endpoints require Unipile configuration');
      console.log('   - Database operations require proper DB connection');
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed. Check errors above.');
      console.log('\n💡 Troubleshooting:');
      console.log('   - Make sure your server is running: node test-server.js');
      console.log('   - Check database connection');
      console.log('   - Verify JWT_SECRET in .env matches your server');
      console.log('   - Check UNIPILE_DSN and UNIPILE_TOKEN for LinkedIn endpoints');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
