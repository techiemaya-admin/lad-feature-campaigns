/**
 * Generate JWT Token for Testing
 * Run: node generate-token.js
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Test user payload
const payload = {
  userId: 1,
  user_id: 1,
  organization_id: 1,
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
console.log('\n');
