/**
 * Unipile Search Controller
 * 
 * Exposes Unipile-based lead and company search API endpoints
 */

const UnipileLeadSearchService = require('../services/UnipileLeadSearchService');
const logger = require('../../../core/utils/logger');

class UnipileSearchController {
  /**
   * Search companies on LinkedIn via Unipile
   * POST /api/unipile/search/companies
   */
  static async searchCompanies(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      
      const { industry, location, accountId, limit = 50 } = req.body;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: accountId'
        });
      }

      if (!industry && !location) {
        return res.status(400).json({
          success: false,
          error: 'At least industry or location is required'
        });
      }

      logger.info('[Unipile Search Controller] Company search', {
        tenantId,
        industry,
        location,
        accountId
      });

      const result = await UnipileLeadSearchService.searchCompanies({
        industry,
        location,
        accountId,
        limit
      });

      res.json({
        success: result.success,
        data: result.companies,
        count: result.count,
        source: 'unipile',
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Unipile Search Controller] Company search error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Search people (leads) on LinkedIn via Unipile
   * POST /api/unipile/search/people
   */
  static async searchPeople(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      
      const { industry, location, designation, company, accountId, limit = 50 } = req.body;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: accountId'
        });
      }

      if (!industry && !location && !designation && !company) {
        return res.status(400).json({
          success: false,
          error: 'At least one filter required: industry, location, designation, or company'
        });
      }

      logger.info('[Unipile Search Controller] People search', {
        tenantId,
        industry,
        location,
        designation,
        company,
        accountId
      });

      const result = await UnipileLeadSearchService.searchPeople({
        industry,
        location,
        designation,
        company,
        accountId,
        limit
      });

      res.json({
        success: result.success,
        data: result.people,
        count: result.count,
        source: 'unipile',
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Unipile Search Controller] People search error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Combined search for companies and leads
   * POST /api/unipile/search
   */
  static async search(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      
      const { industry, location, designation, accountId, limit = 50 } = req.body;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: accountId'
        });
      }

      logger.info('[Unipile Search Controller] Combined search', {
        tenantId,
        industry,
        location,
        designation,
        accountId
      });

      const result = await UnipileLeadSearchService.searchCompaniesAndLeads({
        industry,
        location,
        designation,
        accountId,
        limit
      });

      res.json({
        success: result.success,
        companies: result.companies,
        people: result.people,
        totalCompanies: result.totalCompanies,
        totalPeople: result.totalPeople,
        source: 'unipile',
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Unipile Search Controller] Combined search error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get detailed profile information
   * GET /api/unipile/profile/:linkedinId
   */
  static async getProfile(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
      const { linkedinId } = req.params;
      const { accountId } = req.query;

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required query param: accountId'
        });
      }

      if (!linkedinId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required param: linkedinId'
        });
      }

      logger.info('[Unipile Search Controller] Profile fetch', {
        tenantId,
        linkedinId,
        accountId
      });

      const result = await UnipileLeadSearchService.getProfileDetails(linkedinId, accountId);

      res.json({
        success: result.success,
        profile: result.profile,
        source: 'unipile',
        error: result.error || undefined
      });
    } catch (error) {
      logger.error('[Unipile Search Controller] Profile fetch error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = UnipileSearchController;
