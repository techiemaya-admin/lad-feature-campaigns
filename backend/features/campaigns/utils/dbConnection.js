/**
 * Database Connection Helper
 * Resolves the shared database connection path for both local and production environments
 */

const path = require('path');
const fs = require('fs');

function getDatabaseConnection() {
  // Priority 1: Try main LAD backend (for feature repos in development)
  const mainLADPath = '/Users/naveenreddy/Desktop/AI-Maya/LAD/backend/shared/database/connection';
  try {
    const connection = require(mainLADPath);
    if (connection && connection.pool) {
      console.log(`[DB Connection] ✅ Loaded from main LAD: ${mainLADPath}`);
      return connection;
    }
  } catch (error) {
    // Continue to other methods
  }

  // Priority 2: Try to find shared folder by going up the directory tree
  // This works when feature is deployed in main backend
  const currentDir = __dirname;
  
  let searchDir = currentDir;
  const maxDepth = 10; // Prevent infinite loops
  let depth = 0;
  
  // First, try to find shared folder by traversing up
  while (depth < maxDepth) {
    const sharedPath = path.join(searchDir, 'shared', 'database', 'connection.js');
    if (fs.existsSync(sharedPath)) {
      try {
        const connection = require(sharedPath);
        if (connection && connection.pool) {
          console.log(`[DB Connection] ✅ Loaded from: ${sharedPath}`);
          return connection;
        }
      } catch (error) {
        // Continue searching
      }
    }
    
    const parentDir = path.dirname(searchDir);
    if (parentDir === searchDir) {
      // Reached root, stop
      break;
    }
    searchDir = parentDir;
    depth++;
  }
  
  // Priority 3: Fallback to other common paths
  const possiblePaths = [
    // Production: /app/shared/database/connection
    '/app/shared/database/connection',
    // Local: from various locations
    path.resolve(process.cwd(), 'shared/database/connection'),
    path.resolve(__dirname, '../../../shared/database/connection'),
    path.resolve(__dirname, '../../../../shared/database/connection'),
  ];
  
  for (const dbPath of possiblePaths) {
    try {
      // Try with .js extension first, then without
      let connection;
      if (fs.existsSync(dbPath + '.js')) {
        connection = require(dbPath + '.js');
      } else if (fs.existsSync(dbPath)) {
        connection = require(dbPath);
      } else {
        // Try require anyway (might work with module resolution)
        connection = require(dbPath);
      }
      
      if (connection && connection.pool) {
        console.log(`[DB Connection] ✅ Loaded from: ${dbPath}`);
        return connection;
      }
    } catch (error) {
      // Continue to next path
      continue;
    }
  }

  // If all paths fail, throw error
  throw new Error(`Failed to load database connection. Searched up directory tree and tried paths: ${possiblePaths.join(', ')}`);
}

module.exports = getDatabaseConnection();

