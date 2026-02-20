/**
 * Logger Utility - Centralized logging for LAD Backend
 * 
 * Usage:
 *   const logger = require('../../../../core/utils/logger');
 *   logger.info('Campaign created', { campaignId, userId });
 *   logger.error('Failed to process campaign', { error, campaignId });
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(context = 'App') {
    this.context = context;
    this.level = this.getLogLevel();
  }

  getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    return LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    return `[${timestamp}] [${level}] [${this.context}] ${message} ${metaStr}`;
  }

  error(message, meta = {}) {
    if (this.level >= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage('ERROR', message, meta));
    }
  }

  warn(message, meta = {}) {
    if (this.level >= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage('WARN', message, meta));
    }
  }

  info(message, meta = {}) {
    if (this.level >= LOG_LEVELS.INFO) {
      console.log(this.formatMessage('INFO', message, meta));
    }
  }

  debug(message, meta = {}) {
    if (this.level >= LOG_LEVELS.DEBUG) {
      console.log(this.formatMessage('DEBUG', message, meta));
    }
  }

  // Create child logger with different context
  child(context) {
    return new Logger(`${this.context}:${context}`);
  }
}

// Export singleton instance
module.exports = new Logger('App');

// Export Logger class for custom instances
module.exports.Logger = Logger;
