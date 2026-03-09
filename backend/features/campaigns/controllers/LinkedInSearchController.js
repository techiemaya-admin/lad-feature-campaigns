/**
 * LinkedIn Search Controller
 * LAD Architecture: Controller Layer (validate input + call service + return response)
 * NO SQL here — all data access goes through LinkedInSearchService
 */
const logger = require('../../../core/utils/logger');
const LinkedInSearchService = require('../services/LinkedInSearchService');

const searchService = new LinkedInSearchService();

class LinkedInSearchController {

    /**
     * POST /api/campaigns/linkedin/search/extract-intent
     * Extract structured search filters from natural language query using Gemini AI
     */
    static async extractIntent(req, res) {
        try {
            const { query } = req.body;

            if (!query || typeof query !== 'string' || query.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Query is required and must be a non-empty string'
                });
            }

            const result = await searchService.extractSearchIntent(query.trim());

            return res.json({
                success: true,
                intent: result.intent,
                summary: searchService.generateIntentSummary(result.intent)
            });
        } catch (error) {
            logger.error('[LinkedInSearchController] extractIntent error', { error: error.message });
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * GET /api/campaigns/linkedin/search/parameters
     * Resolve location/industry names to LinkedIn IDs via Unipile parameters API
     */
    static async resolveParameters(req, res) {
        try {
            const { type, q } = req.query;
            const tenantId = req.user.tenantId || req.user.userId;

            if (!type || !q) {
                return res.status(400).json({
                    success: false,
                    error: 'Both type (LOCATION|INDUSTRY) and q (search term) are required'
                });
            }

            // Get account ID for tenant
            const accountId = await searchService.getAccountIdForTenant(tenantId, { user: req.user });

            let results = [];
            if (type.toUpperCase() === 'LOCATION') {
                results = await searchService.resolveLocationIds(q, accountId);
            } else if (type.toUpperCase() === 'INDUSTRY') {
                results = await searchService.resolveIndustryIds(q, accountId);
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid type. Must be LOCATION or INDUSTRY.'
                });
            }

            return res.json({
                success: true,
                type: type.toUpperCase(),
                query: q,
                results
            });
        } catch (error) {
            logger.error('[LinkedInSearchController] resolveParameters error', { error: error.message });
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * POST /api/campaigns/linkedin/search
     * Execute full LinkedIn people search pipeline:
     *   natural language → Gemini AI → Unipile search
     */
    static async searchPeople(req, res) {
        try {
            const { query, filters = {}, start = 0, count = 25 } = req.body;
            const tenantId = req.user.tenantId || req.user.userId;

            if (!query || typeof query !== 'string' || query.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Query is required'
                });
            }

            // Get account ID for tenant
            const accountId = await searchService.getAccountIdForTenant(tenantId, { user: req.user });

            // Full search pipeline
            const result = await searchService.fullSearch(
                query.trim(),
                accountId,
                { ...filters, start, count }
            );

            return res.json({
                success: true,
                intent: result.intent,
                summary: searchService.generateIntentSummary(result.intent),
                resolvedFilters: result.resolvedFilters,
                results: result.results,
                total: result.total,
                paging: result.paging
            });
        } catch (error) {
            logger.error('[LinkedInSearchController] searchPeople error', { error: error.message });
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = LinkedInSearchController;
