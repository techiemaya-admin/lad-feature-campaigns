/**
 * Generate JWT Token for Testing
 * Run: node generate-token.js
 */

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Try to load .env file
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
} catch (e) {
  // dotenv not available, that's okay
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Test user payload
const payload = {
  userId: 1,
  user_id: 1,
  tenantId: 1,
  tenant_id: 1,
  organization_id: 1,
  orgId: 1,
  email: 'test@example.com'
};

// Generate token
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

console.log('\n=== JWT Token for Testing ===\n');
console.log('Token:');
console.log(token);
console.log('\n=== Usage in API Requests ===\n');
console.log('Add this header to your requests:');
console.log(`Authorization: Bearer ${token}`);
console.log('\n=== cURL Example ===\n');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3000/api/campaigns`);
console.log('\n=== PowerShell Example ===\n');
console.log(`$headers = @{ "Authorization" = "Bearer ${token}" }`);
console.log(`Invoke-WebRequest -Uri "http://localhost:3000/api/campaigns" -Headers $headers`);
console.log('\n=== Copy to Clipboard (Windows) ===\n');
console.log(`echo "${token}" | clip`);
console.log('\n');

