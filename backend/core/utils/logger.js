/**
 * Centralized Logger Utility
 * LAD Architecture Compliant - No console.log in production
 * 
 * This should delegate to LAD core logger when available,
 * or provide a simple implementation for standalone feature repos.
 */

let logger;

// Try to load from LAD core first
try {
  // Try to load from shared LAD core if available
  const coreLogger = require('../../../../lad-feature-apollo-leads/backend/core/utils/logger');
  logger = coreLogger;
} catch (error) {
  // Fallback: Create simple logger for standalone feature repo
  // LAD Architecture: No console.log in production - use silent logger in production
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
  const isProduction = process.env.NODE_ENV === 'production';
  
  logger = {
    debug: (message, ...args) => {
      // Only log in development
      if (isDevelopment) {
        if (!isProduction) {
          process.stdout.write(`[DEBUG] ${message}\n`);
          if (args.length > 0) {
            process.stdout.write(JSON.stringify(args, null, 2) + '\n');
          }
        }
      }
    },
    info: (message, ...args) => {
      // Only log in development
      if (isDevelopment) {
        if (!isProduction) {
          process.stdout.write(`[INFO] ${message}\n`);
          if (args.length > 0) {
            process.stdout.write(JSON.stringify(args, null, 2) + '\n');
          }
        }
      }
    },
    warn: (message, ...args) => {
      // Warnings should always be logged, but use process.stderr in production
      if (isProduction) {
        process.stderr.write(`[WARN] ${message}\n`);
        if (args.length > 0) {
          process.stderr.write(JSON.stringify(args, null, 2) + '\n');
        }
      } else {
        process.stderr.write(`[WARN] ${message}\n`);
        if (args.length > 0) {
          process.stderr.write(JSON.stringify(args, null, 2) + '\n');
        }
      }
    },
    error: (message, ...args) => {
      // Errors should always be logged, but use process.stderr in production
      if (isProduction) {
        process.stderr.write(`[ERROR] ${message}\n`);
        if (args.length > 0) {
          process.stderr.write(JSON.stringify(args, null, 2) + '\n');
        }
      } else {
        process.stderr.write(`[ERROR] ${message}\n`);
        if (args.length > 0) {
          process.stderr.write(JSON.stringify(args, null, 2) + '\n');
        }
      }
    }
  };
}

module.exports = logger;

