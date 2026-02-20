#!/usr/bin/env node
/**
 * LAD Backend Server
 * Production-grade SaaS platform with feature-based architecture
 * Version: 1.0.1
 */

require('dotenv').config();
const CoreApplication = require('./core/app');
const logger = require('./core/utils/logger');

const PORT = process.env.PORT || 3004;

async function startServer() {
  try {
    logger.info('Starting LAD Backend Server');
    
    // Check critical environment variables
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-secret-key-change-in-production') {
      logger.warn('⚠️  JWT_SECRET is not properly configured. Using development default.');
      logger.warn('    For production, ensure JWT_SECRET is set via Google Cloud Secret Manager');
    } else {
      logger.info('✓ JWT_SECRET is configured');
    }
    
    logger.info('Server configuration', {
      environment: process.env.NODE_ENV || 'development',
      database: process.env.POSTGRES_HOST,
      schema: process.env.POSTGRES_SCHEMA || 'lad_dev',
      jwtConfigured: !!jwtSecret && jwtSecret !== 'your-secret-key-change-in-production'
    });
    
    const app = new CoreApplication();
    await app.start(PORT);
    
    logger.info('Server successfully started', {
      port: PORT,
      url: process.env.BACKEND_URL || process.env.BASE_URL || `http://localhost:${PORT}`,
      feature: 'community-roi',
      endpoints: [
        'POST /api/auth/login',
        'POST /api/auth/register', 
        'GET /api/features',
        'GET /api/users/:id',
        'GET /api/community-roi/members',
        'GET /api/community-roi/relationships',
        'POST /api/community-roi/webhook/whatsapp'
      ]
    });
    
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();
