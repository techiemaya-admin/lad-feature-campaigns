/**
 * Person ID Resolver Service
 * LAD Architecture: Business logic only - delegates SQL to repository
 * 
 * Resolves person IDs - handles both Apollo person IDs and campaign lead UUIDs.
 */

const CampaignLeadLookupRepository = require('../repositories/CampaignLeadLookupRepository');
const { getSchema } = require('../../../core/utils/schemaHelper');

class PersonIdResolverService {
  /**
   * Resolve person ID - accepts either Apollo person ID or campaign lead UUID
   * LAD Architecture: Business logic layer
   * 
   * @param {string} personId - Either Apollo person ID (numeric) or campaign lead UUID
   * @param {object} req - Request object for schema and tenant context
   * @returns {Promise<{apolloPersonId: string, fromCampaignLead: boolean}>}
   */
  async resolvePersonId(personId, req) {
    // Check if personId is a UUID (campaign lead ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(personId)) {
      // Already an Apollo person ID (numeric string)
      return {
        apolloPersonId: personId,
        fromCampaignLead: false
      };
    }
    
    // It's a campaign lead UUID - look up Apollo person ID
    const schema = getSchema(req);
    // LAD Architecture: Support both snake_case and camelCase tenant ID
    const tenantId = req.user?.tenant_id || req.user?.tenantId || req.tenant?.id;
    
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    
    const result = await CampaignLeadLookupRepository.getApolloPersonIdFromCampaignLead(
      personId,
      tenantId,
      schema
    );
    
    if (!result) {
      throw new Error('Campaign lead not found');
    }
    
    // Use apollo_person_id first, fallback to id
    const apolloPersonId = result.apollo_person_id || result.apollo_id;
    
    if (!apolloPersonId) {
      throw new Error('Apollo person ID not found in lead data');
    }
    
    return {
      apolloPersonId,
      fromCampaignLead: true
    };
  }
}

module.exports = new PersonIdResolverService();
