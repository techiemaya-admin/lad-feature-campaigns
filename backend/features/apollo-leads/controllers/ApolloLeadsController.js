const ApolloLeadsService = require('../services/ApolloLeadsService');
const PersonIdResolverService = require('../services/PersonIdResolverService');
const logger = require('../../../core/utils/logger');

/**
 * Helper to validate tenant context (standalone function to avoid 'this' binding issues)
 */
function validateTenant(req) {
  // Support both snake_case (tenant_id) and camelCase (tenantId) field names
  const tenantId = req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || req.headers?.['x-tenant-id'];
  if (!tenantId && process.env.NODE_ENV === 'production') {
    throw new Error('Tenant context required');
  }
  return tenantId;
}

class ApolloLeadsController {

  async searchCompanies(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      // Support both POST (body) and GET (query) parameters
      // POST requests use req.body, GET requests use req.query
      const params = req.method === 'POST' ? req.body : req.query;
      
      const {
        keywords,
        industry,
        location,
        company_size,
        revenue_range,
        technology,
        limit = 50,
        page = 1
      } = params;

      const searchParams = {
        keywords: keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',')) : [],
        industry,
        location,
        company_size,
        revenue_range,
        technology,
        limit: parseInt(limit),
        page: parseInt(page)
      };

      const results = await ApolloLeadsService.searchCompanies(searchParams, req);
      
      res.json({
        success: true,
        data: results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: results.length
        }
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Apollo search error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Search failed',
        message: error.message
      });
    }
  }

  async bulkSearchCompanies(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      const { searches } = req.body;
      
      if (!Array.isArray(searches)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'searches must be an array'
        });
      }

      const results = await Promise.all(
        searches.map(search => ApolloLeadsService.searchCompanies(search))
      );

      res.json({
        success: true,
        data: results,
        total_searches: searches.length
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Apollo bulk search error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Bulk search failed',
        message: error.message
      });
    }
  }

  async getCompanyDetails(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      const { id } = req.params;
      const company = await ApolloLeadsService.getCompanyById(id);
      
      if (!company) {
        return res.status(404).json({
          error: 'Company not found',
          message: `Company with ID ${id} not found`
        });
      }

      res.json({
        success: true,
        data: company
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Get company details error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Failed to get company details',
        message: error.message
      });
    }
  }

  async getCompanyLeads(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      const { id } = req.params;
      const { limit = 25, page = 1, title_filter } = req.query;

      const leads = await ApolloLeadsService.getCompanyLeads(id, {
        limit: parseInt(limit),
        page: parseInt(page),
        title_filter
      });

      res.json({
        success: true,
        data: leads
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Get company leads error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Failed to get company leads',
        message: error.message
      });
    }
  }

  async revealEmail(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      // Support both GET /leads/:id/email and POST /reveal-email
      let personId = req.params.id || req.body.person_id;
      const employeeName = req.body.employee_name || null;
      
      if (!personId) {
        return res.status(400).json({
          success: false,
          error: 'person_id is required'
        });
      }
      
      // LAD Architecture: Use service to resolve person ID (handles both Apollo ID and campaign lead UUID)
      const resolved = await PersonIdResolverService.resolvePersonId(personId, req);
      personId = resolved.apolloPersonId;
      
      const result = await ApolloLeadsService.revealEmail(personId, employeeName, req);
      
      if (result.error) {
        return res.json({
          success: false,
          error: result.error,
          credits_used: result.credits_used
        });
      }
      
      res.json({
        success: true,
        email: result.email,
        from_cache: result.from_cache,
        credits_used: result.credits_used
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Reveal email error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Email reveal failed',
        message: error.message
      });
    }
  }

  async revealPhone(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      // Support both GET /leads/:id/phone and POST /reveal-phone
      let personId = req.params.id || req.body.person_id;
      const employeeName = req.body.employee_name || null;
      
      if (!personId) {
        return res.status(400).json({
          success: false,
          error: 'person_id is required'
        });
      }
      
      // LAD Architecture: Use service to resolve person ID (handles both Apollo ID and campaign lead UUID)
      const resolved = await PersonIdResolverService.resolvePersonId(personId, req);
      personId = resolved.apolloPersonId;
      
      const result = await ApolloLeadsService.revealPhone(personId, employeeName, req);
      
      if (result.error) {
        return res.json({
          success: false,
          error: result.error,
          credits_used: result.credits_used
        });
      }
      
      res.json({
        success: true,
        phone: result.phone,
        from_cache: result.from_cache,
        credits_used: result.credits_used
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Reveal phone error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Phone reveal failed',
        message: error.message
      });
    }
  }

  async getSearchHistory(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      const userId = req.user?.id || 'demo-user';
      const { limit = 50, page = 1 } = req.query;

      const history = await ApolloLeadsService.getSearchHistory(userId, {
        limit: parseInt(limit),
        page: parseInt(page)
      }, req);

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Get search history error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Failed to get search history',
        message: error.message
      });
    }
  }

  async deleteSearchHistory(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      validateTenant(req);
      
      const { id } = req.params;
      const userId = req.user?.id || 'demo-user';

      await ApolloLeadsService.deleteSearchHistory(id, userId);

      res.json({
        success: true,
        message: 'Search history deleted'
      });
    } catch (error) {
      logger.error('[Apollo Leads Controller] Delete search history error', {
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Failed to delete search history',
        message: error.message
      });
    }
  }

  /**
   * Search employees from database cache (employees_cache table)
   * Falls back to Apollo API if no results found in database
   * LAD Architecture: Enforces tenant context
   */
  async searchEmployeesFromDb(req, res) {
    try {
      // LAD Architecture: Validate tenant context
      // Support both authenticated requests and internal service calls via header
      const tenantId = req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || req.headers['x-tenant-id'];
      
      if (!tenantId && process.env.NODE_ENV === 'production') {
        logger.warn('[Apollo Leads Controller] Missing tenant context', {
          hasUser: !!req.user,
          hasTenant: !!req.tenant,
          hasHeader: !!req.headers['x-tenant-id'],
          headers: Object.keys(req.headers)
        });
        return res.status(400).json({
          success: false,
          error: 'Tenant context required'
        });
      }
      
      logger.debug('[Apollo Leads Controller] Processing search with tenant context', {
        tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none',
        source: req.user ? 'user' : req.headers['x-tenant-id'] ? 'header' : 'tenant'
      });
      
      // Pass req for schema and tenant context
      const result = await ApolloLeadsService.searchEmployeesFromDb(req.body, req);
      res.json(result);
    } catch (error) {
      logger.error('[Apollo Leads Controller] Search employees from DB error', {
        error: error.message,
        stack: error.stack
      });
      res.status(error.message.includes('required') ? 400 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle webhook callback from Apollo for phone number reveal
   * Apollo sends phone numbers asynchronously to this endpoint
   */
  async handlePhoneRevealWebhook(req, res) {
    try {
      logger.info('[Apollo Webhook] Phone reveal webhook received', {
        body: req.body,
        headers: req.headers
      });

      // Apollo sends the data in the request body
      // Store it in the database for the person
      const result = await ApolloLeadsService.handlePhoneRevealWebhook(req.body);

      res.json({
        success: true,
        message: 'Webhook received',
        result
      });
    } catch (error) {
      logger.error('[Apollo Webhook] Phone reveal webhook error', {
        error: error.message,
        stack: error.stack,
        body: req.body
      });
      
      // Still return 200 to Apollo so they don't retry
      res.json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new ApolloLeadsController();
