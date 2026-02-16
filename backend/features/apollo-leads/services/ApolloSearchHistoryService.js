/**
 * Apollo Search History Service
 * LAD Architecture Compliant - Business logic only, calls repository for SQL
 * 
 * Handles search history operations with proper tenant isolation.
 */

const { getSchema } = require('../../../core/utils/schemaHelper');
const { requireTenantId } = require('../../../core/utils/tenantHelper');
const { SEARCH_HISTORY_CONFIG } = require('../../../core/config/constants');
const logger = require('../../../core/utils/logger');
const ApolloSearchHistoryRepository = require('../repositories/ApolloSearchHistoryRepository');

class ApolloSearchHistoryService {
  /**
   * Save search history
   * LAD Architecture: Business logic only - delegates SQL to repository
   * 
   * @param {Object} searchData - Search data to save
   * @param {Object} req - Express request object (for tenant context)
   */
  async saveSearchHistory(searchData, req = null) {
    try {
      // LAD Architecture: Require tenant context
      const tenantId = requireTenantId(
        searchData.tenantId,
        req,
        'saveSearchHistory'
      );
      const schema = getSchema(req);

      // LAD Architecture: Delegate SQL to repository
      await ApolloSearchHistoryRepository.save(searchData, schema, tenantId);
      
      logger.debug('[Apollo Search History] Search history saved', {
        userId: searchData.userId,
        resultsCount: searchData.results
      });
    } catch (error) {
      logger.error('[Apollo Search History] Save search history error', { 
        error: error.message, 
        stack: error.stack 
      });
      // Don't throw - this is not critical
    }
  }

  /**
   * Get search history
   * LAD Architecture: Business logic only - delegates SQL to repository
   * 
   * @param {string} userId - User ID
   * @param {Object} options - Query options (limit, page)
   * @param {Object} req - Express request object (for tenant context)
   * @returns {Promise<Array>} Search history records
   */
  async getSearchHistory(userId, options = {}, req = null) {
    const { 
      limit = SEARCH_HISTORY_CONFIG.DEFAULT_LIMIT, 
      page = SEARCH_HISTORY_CONFIG.DEFAULT_PAGE 
    } = options;
    const offset = (page - 1) * limit;

    try {
      // LAD Architecture: Require tenant context
      const tenantId = requireTenantId(null, req, 'getSearchHistory');
      const schema = getSchema(req);
      
      // LAD Architecture: Delegate SQL to repository
      return await ApolloSearchHistoryRepository.findByUser(userId, tenantId, schema, { limit, offset });
    } catch (error) {
      logger.error('[Apollo Search History] Get search history error', { 
        error: error.message, 
        stack: error.stack 
      });
      return [];
    }
  }

  /**
   * Delete search history
   * LAD Architecture: Business logic only - delegates SQL to repository
   * 
   * @param {string} historyId - History record ID
   * @param {string} userId - User ID
   * @param {Object} req - Express request object (for tenant context)
   */
  async deleteSearchHistory(historyId, userId, req = null) {
    try {
      // LAD Architecture: Require tenant context
      const tenantId = requireTenantId(null, req, 'deleteSearchHistory');
      const schema = getSchema(req);
      
      // LAD Architecture: Delegate SQL to repository
      const deleted = await ApolloSearchHistoryRepository.delete(historyId, userId, tenantId, schema);
      
      if (!deleted) {
        throw new Error('Search history record not found or access denied');
      }
      
      logger.debug('[Apollo Search History] Search history deleted', {
        historyId,
        userId
      });
    } catch (error) {
      logger.error('[Apollo Search History] Delete search history error', { 
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }
}

module.exports = new ApolloSearchHistoryService();

