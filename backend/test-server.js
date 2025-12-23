/**
 * Test Server for Campaign Feature
 * Simple Express server to test the campaigns feature
 */

const path = require('path');
const fs = require('fs');

// Load .env file from project root (lad-feature-campaigns/.env)
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    require('dotenv').config();
  }
} catch (e) {
  // dotenv not available, that's okay
}

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Use real JWT auth middleware for testing
const { jwtAuth } = require('./middleware/auth');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'LAD Campaigns Feature',
    timestamp: new Date().toISOString()
  });
});

// Mock database connection if not available
try {
  require.resolve('../../../shared/database/connection');
} catch (e) {
  // Database connection not available, use mock
  console.log('⚠️  Database connection not found, using mock database');
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(...args) {
    if (args[0] === '../../../shared/database/connection' || 
        args[0] === '../../../../shared/database/connection') {
      return require('./mock-database');
    }
    return originalRequire.apply(this, args);
  };
}

// Test if we can load the feature modules
try {
  const campaignRoutes = require('./routes/index');
  const LinkedInWebhookController = require('./controllers/LinkedInWebhookController');
  
  console.log('✓ Campaign routes loaded successfully');
  
  // Mount LinkedIn webhook route WITHOUT auth (webhooks don't need auth)
  app.post('/api/campaigns/linkedin/webhook', LinkedInWebhookController.handleWebhook);
  
  // Mount all other routes with JWT auth
  app.use('/api/campaigns', jwtAuth, campaignRoutes);
  console.log('✓ Campaign routes mounted at /api/campaigns');
  console.log('✓ LinkedIn webhook mounted without auth');
} catch (error) {
  console.error('✗ Error loading campaign routes:', error.message);
  console.error('  Stack:', error.stack);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n=================================');
  console.log(`✓ Test server running on port ${PORT}`);
  console.log('=================================');
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoint: http://localhost:${PORT}/api/campaigns`);
  console.log('\nNote: Database operations will fail without proper DB connection.');
  console.log('This test verifies that modules load correctly.\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});
