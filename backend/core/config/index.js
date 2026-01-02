/**
 * Configuration Management for Campaign Feature
 * Loads environment variables and provides defaults
 */

require('dotenv').config();

const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3003,
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  DB_SCHEMA: process.env.DB_SCHEMA,
  
  // External Services
  APOLLO_API_KEY: process.env.APOLLO_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  
  // AI Configuration
  AI_MODEL: process.env.AI_MODEL || 'gemini-pro',
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS) || 2048,
  
  // Campaign Settings
  DEFAULT_CAMPAIGN_DURATION: parseInt(process.env.DEFAULT_CAMPAIGN_DURATION) || 30,
  MAX_DAILY_ACTIONS: parseInt(process.env.MAX_DAILY_ACTIONS) || 100,
  
  // Security
  JWT_SECRET: process.env.JWT_SECRET,
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [],
  
  // Rate Limiting
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  
  // Delays and Timing
  MIN_DELAY_HOURS: parseInt(process.env.MIN_DELAY_HOURS) || 1,
  MAX_DELAY_DAYS: parseInt(process.env.MAX_DELAY_DAYS) || 14,
};

// Validation for required variables in production
if (config.NODE_ENV === 'production') {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGINS'];
  
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

module.exports = config;