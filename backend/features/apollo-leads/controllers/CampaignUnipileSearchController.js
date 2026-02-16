/**
 * Campaign Unipile Search Controller
 * 
 * Handles lead search for campaigns using Unipile as primary source,
 * with Apollo as fallback for compatibility.
 */

const UnipileApolloAdapterService = require('../services/UnipileApolloAdapterService');
const logger = require('../../../core/utils/logger');

class CampaignUnipileSearchController {
  /**
   * Search leads for campaign using Unipile with Apollo fallback
   * 
   * Request body:
   * {
   *   keywords?: string,
   *   industry?: string (name or ID),
   *   location?: string (name or ID),
   *   designation?: string (job title),
   *   company?: string,
   *   skills?: string,
   *   limit?: number,
   *   accountId: string (Unipile account ID),
   *   prefer_source?: 'unipile' | 'apollo'
   * }
   */
  static async searchLeadsForCampaign(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.tenant?.id || req.headers?.['x-tenant-id'];
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Tenant context required'
        });
      }

      const {
        keywords,
        industry,
        location,
        designation,
        company,
        skills,
        limit = 50,
        accountId,
        prefer_source = 'unipile'
      } = req.body;

      logger.info('[Campaign Unipile Search] Searching leads for campaign', {
        tenantId,
        filters: { industry, location, designation },
        prefer_source
      });

      // Validate at least one filter
      if (!keywords && !industry && !location && !designation && !company && !skills) {
        return res.status(400).json({
          success: false,
          error: 'At least one search filter is required',
          fields: ['keywords', 'industry', 'location', 'designation', 'company', 'skills']
        });
      }

      const campaignParams = {
        keywords,
        industry,
        location,
        designation,
        company,
        skills,
        limit,
        accountId
      };

      // Search with fallback
      const result = await UnipileApolloAdapterService.searchLeadsWithSourcePreference(
        campaignParams,
        prefer_source
      );

      res.json({
        success: result.success,
        data: result.people,
        count: result.count,
        source: result.source,
        sources_tried: result.sources_tried,
        errors: result.errors.length > 0 ? result.errors : undefined,
        pagination: {
          page: 1,
          limit,
          total: result.count
        }
      });
    } catch (error) {
      logger.error('[Campaign Unipile Search] Error searching leads', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: 'Failed to search leads',
        message: error.message
      });
    }
  }

  /**
   * Get source statistics and capabilities
   */
  static async getSourceStats(req, res) {
    try {
      // Validate tenant context
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.tenant?.id || req.headers?.['x-tenant-id'];
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Tenant context required'
        });
      }

      logger.info('[Campaign Unipile Search] Getting source statistics', { tenantId });

      const stats = UnipileApolloAdapterService.getSourceStats();

      res.json({
        success: true,
        sources: stats
      });
    } catch (error) {
      logger.error('[Campaign Unipile Search] Error getting source stats', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get source statistics',
        message: error.message
      });
    }
  }

  /**
   * Test both sources with sample parameters
   */
  static async testSources(req, res) {
    try {
      // Validate tenant context
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.tenant?.id || req.headers?.['x-tenant-id'];
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Tenant context required'
        });
      }

      const {
        keywords = 'Director',
        industry = 'Technology',
        location = 'Dubai',
        accountId
      } = req.body;

      logger.info('[Campaign Unipile Search] Testing both sources', { tenantId });

      const campaignParams = {
        keywords,
        industry,
        location,
        limit: 5,
        accountId
      };

      // Test Unipile
      let unipileResult = { success: false, error: 'Not tested' };
      if (accountId) {
        try {
          unipileResult = await UnipileApolloAdapterService.searchLeadsWithSourcePreference(
            campaignParams,
            'unipile'
          );
        } catch (error) {
          unipileResult.error = error.message;
        }
      } else {
        unipileResult.error = 'accountId is required for Unipile';
      }

      // Test Apollo
      let apolloResult = { success: false, error: 'Not tested' };
      try {
        apolloResult = await UnipileApolloAdapterService.searchLeadsWithSourcePreference(
          campaignParams,
          'apollo'
        );
      } catch (error) {
        apolloResult.error = error.message;
      }

      res.json({
        success: true,
        test_params: { keywords, industry, location },
        results: {
          unipile: {
            success: unipileResult.success,
            count: unipileResult.count || 0,
            error: unipileResult.error
          },
          apollo: {
            success: apolloResult.success,
            count: apolloResult.count || 0,
            error: apolloResult.error
          }
        }
      });
    } catch (error) {
      logger.error('[Campaign Unipile Search] Error in test sources', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Test failed',
        message: error.message
      });
    }
  }

  /**
   * Compare results from both sources
   */
  static async compareSourceResults(req, res) {
    try {
      // Validate tenant context
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.tenant?.id || req.headers?.['x-tenant-id'];
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Tenant context required'
        });
      }

      const {
        keywords,
        industry,
        location,
        designation,
        accountId
      } = req.body;

      const campaignParams = {
        keywords,
        industry,
        location,
        designation,
        limit: 25,
        accountId
      };

      logger.info('[Campaign Unipile Search] Comparing source results', {
        tenantId,
        filters: { industry, location, designation }
      });

      // Get Unipile results
      let unipileResult = { people: [], count: 0, source: null, error: null };
      if (accountId) {
        unipileResult = await UnipileApolloAdapterService.searchLeadsWithSourcePreference(
          campaignParams,
          'unipile'
        );
      }

      // Get Apollo results
      let apolloResult = { people: [], count: 0, source: null, error: null };
      try {
        apolloResult = await UnipileApolloAdapterService.searchLeadsWithSourcePreference(
          campaignParams,
          'apollo'
        );
      } catch (error) {
        apolloResult.error = error.message;
      }

      // Compare
      const comparison = {
        unipile: {
          count: unipileResult.count,
          success: unipileResult.success,
          error: unipileResult.error,
          sample: unipileResult.people?.slice(0, 3) || []
        },
        apollo: {
          count: apolloResult.count,
          success: apolloResult.success,
          error: apolloResult.error,
          sample: apolloResult.people?.slice(0, 3) || []
        },
        difference: Math.abs((unipileResult.count || 0) - (apolloResult.count || 0)),
        recommendation: unipileResult.success ? 'Use Unipile (free, real-time)' : 'Use Apollo (fallback)'
      };

      res.json({
        success: true,
        search_params: { keywords, industry, location, designation },
        comparison
      });
    } catch (error) {
      logger.error('[Campaign Unipile Search] Error comparing sources', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Comparison failed',
        message: error.message
      });
    }
  }
}

module.exports = CampaignUnipileSearchController;
