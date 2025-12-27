/**
 * Database Connection Helper
 * Resolves the shared database connection path for both local and production environments
 */

const path = require('path');

function getDatabaseConnection() {
  // Try multiple possible paths
  // __dirname is: backend/features/campaigns/utils/
  const possiblePaths = [
    // Production path: from /app/features/campaigns/utils/ to /app/shared/database/connection
    path.resolve(__dirname, '../../../shared/database/connection'),
    // Local path: from backend/features/campaigns/utils/ to shared/database/connection (go up 4 levels)
    path.resolve(__dirname, '../../../../shared/database/connection'),
    // Alternative: try from root
    path.resolve(process.cwd(), 'shared/database/connection'),
  ];

  for (const dbPath of possiblePaths) {
    try {
      const connection = require(dbPath);
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
  throw new Error(`Failed to load database connection. Tried paths: ${possiblePaths.join(', ')}`);
}

module.exports = getDatabaseConnection();

