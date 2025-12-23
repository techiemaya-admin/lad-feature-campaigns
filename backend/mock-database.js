/**
 * Mock Database Connection for Testing
 * This provides a mock pool object when the real database connection is not available
 */

// Mock pool object for testing
const mockPool = {
  query: async (text, params) => {
    // Return empty result set - no mock data
    return {
      rows: [],
      rowCount: 0
    };
  },
  
  connect: async () => {
    console.warn('[Mock DB] Connection attempted - using mock');
    return {
      query: mockPool.query,
      release: () => {}
    };
  },
  
  end: async () => {
    console.warn('[Mock DB] Pool end called - mock cleanup');
  }
};

module.exports = {
  pool: mockPool
};

