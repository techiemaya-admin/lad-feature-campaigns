/**
 * Socket.IO Service
 * 
 * Manages WebSocket connections for real-time features
 * Integrated with notification listeners for call logs updates
 */

const { Server } = require('socket.io');
const logger = require('../../core/utils/logger');

class SocketService {
  constructor() {
    this.io = null;
    this.server = null;
  }

  /**
   * Initialize Socket.IO server
   * @param {http.Server} server - HTTP server instance
   */
  initialize(server) {
    this.server = server;
    
    // Get allowed origins from environment variable or fallback to localhost for development
    const envOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];
    const allowedOrigins = [
      ...envOrigins,
      'http://localhost:3000',
      'http://localhost:3001',
      'https://lad-frontend-develop-741719885039.us-central1.run.app',
      'https://lad-frontend-main-741719885039.us-central1.run.app',
      'https://lad-frontend-stage-3nddlneyya-uc.a.run.app',
      'https://www.mrlads.com',
      'https://app.mrlads.com',
      'https://dev.mrlads.com',
      'https://stage.mrlads.com'
    ];

    this.io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    logger.info('[SocketService] Socket.IO server initialized', {
      allowedOrigins: allowedOrigins.length
    });
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.debug('[SocketService] Client connected', {
        socketId: socket.id,
        clientIP: socket.request.connection.remoteAddress
      });

      // Handle client disconnection
      socket.on('disconnect', (reason) => {
        logger.debug('[SocketService] Client disconnected', {
          socketId: socket.id,
          reason
        });
      });

      // Handle room joining (for tenant-specific updates)
      socket.on('join', (room) => {
        socket.join(room);
        logger.debug('[SocketService] Client joined room', {
          socketId: socket.id,
          room
        });
      });

      // Handle room leaving
      socket.on('leave', (room) => {
        socket.leave(room);
        logger.debug('[SocketService] Client left room', {
          socketId: socket.id,
          room
        });
      });
    });
  }

  /**
   * Emit call logs update to all clients
   * @param {string} tenantId - Tenant ID for scoped updates
   * @param {Object} data - Call log data
   */
  emitCallLogsUpdate(tenantId, data = {}) {
    if (!this.io) {
      logger.warn('[SocketService] Socket.IO not initialized, skipping call logs update');
      return;
    }

    try {
      // Emit to all clients (frontend filters by tenant automatically)
      this.io.emit('calllogs:update', {
        tenantId,
        timestamp: new Date().toISOString(),
        ...data
      });

      // Also emit to tenant-specific room if clients are using rooms
      this.io.to(tenantId).emit('calllogs:update', {
        tenantId,
        timestamp: new Date().toISOString(),
        ...data
      });

      logger.debug('[SocketService] Emitted call logs update', {
        tenantId,
        connectedClients: this.io.engine.clientsCount
      });
    } catch (error) {
      logger.error('[SocketService] Failed to emit call logs update', {
        error: error.message,
        tenantId
      });
    }
  }

  /**
   * Get Socket.IO server instance
   */
  getIO() {
    return this.io;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      initialized: this.io !== null,
      connectedClients: this.io ? this.io.engine.clientsCount : 0
    };
  }
}

// Singleton instance
let instance = null;

function getSocketService() {
  if (!instance) {
    instance = new SocketService();
  }
  return instance;
}

module.exports = {
  SocketService,
  getSocketService
};