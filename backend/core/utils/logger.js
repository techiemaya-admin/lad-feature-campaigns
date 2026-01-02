/**
 * Production Logger Utility
 * Provides structured logging with environment-based levels
 */

const config = require('../config');

class Logger {
  constructor(context = 'App') {
    this.context = context;
    this.level = config.LOG_LEVEL || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
  }

  log(level, message, metadata = {}) {
    if (this.levels[level] <= this.levels[this.level]) {
      const timestamp = new Date().toISOString();
      const logData = {
        timestamp,
        level: level.toUpperCase(),
        context: this.context,
        message,
        ...metadata
      };

      if (config.NODE_ENV === 'production') {
        process.stdout.write(JSON.stringify(logData) + '\n');
      }
    }
  }

  info(message, metadata) {
    this.log('info', message, metadata);
  }

  error(message, metadata) {
    this.log('error', message, metadata);
  }

  warn(message, metadata) {
    this.log('warn', message, metadata);
  }

  debug(message, metadata) {
    this.log('debug', message, metadata);
  }
}

const logger = new Logger('CampaignService');

module.exports = logger;
