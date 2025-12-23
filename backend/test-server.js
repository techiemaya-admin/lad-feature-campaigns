/**
 * Test Server for Campaign Feature
 * Simple Express server to test the campaigns feature
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock authentication middleware for testing
const mockAuth = (req, res, next) => {
  req.user = {
    userId: 1,
    user_id: 1,
    organization_id: 1,
    email: 'test@example.com'
  };
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'LAD Campaigns Feature',
    timestamp: new Date().toISOString()
  });
});

// Mock campaigns endpoint for testing without database
app.get('/api/campaigns', mockAuth, (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: '1',
        name: 'Test Campaign 1',
        status: 'active',
        leads_count: 10,
        sent_count: 5,
        replied_count: 2
      },
      {
        id: '2',
        name: 'Test Campaign 2',
        status: 'draft',
        leads_count: 0,
        sent_count: 0,
        replied_count: 0
      }
    ],
    message: 'Mock data - database not connected'
  });
});

// Test if we can load the feature modules (optional, won't break if it fails)
try {
  const campaignRoutes = require('./routes/index');
  console.log('✓ Campaign routes loaded successfully (with DB)');
  // Don't mount - using mock endpoint above
} catch (error) {
  console.log('ℹ Using mock data (database not available)');
  console.log('  This is expected for standalone testing');
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
