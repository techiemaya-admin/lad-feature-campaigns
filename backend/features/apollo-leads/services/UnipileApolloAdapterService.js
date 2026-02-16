/**
 * Unipile-Apollo Adapter Service
 * 
 * Maps Unipile responses to Apollo format and manages dual-source lead generation.
 * Primary: Unipile (free LinkedIn API)
 * Fallback: Apollo (traditional lead source)
 * 
 * This adapter ensures consistent response format regardless of source.
 */

const axios = require('axios');
const logger = require('../../../core/utils/logger');
const UnipileLeadSearchService = require('./UnipileLeadSearchService');
const { searchEmployeesFromApollo } = require('./ApolloApiService');

class UnipileApolloAdapterService {
  /**
   * Convert campaign search parameters to Unipile format
   * @param {Object} campaignParams - Campaign parameters (industry, location, designation, etc.)
   * @returns {Object} Unipile search parameters
   */
  convertCampaignParamsToUnipile(campaignParams) {
    const {
      keywords,
      industry,
      location,
      designation,
      company,
      skills,
      limit = 50,
      accountId
    } = campaignParams;

    return {
      accountId,
      keywords,
      industry,
      location,
      designation,
      company,
      skills,
      limit: Math.min(limit, 100) // Unipile limit
    };
  }

  /**
   * Convert campaign search parameters to Apollo format
   * @param {Object} campaignParams - Campaign parameters
   * @returns {Object} Apollo search parameters
   */
  convertCampaignParamsToApollo(campaignParams) {
    const {
      keywords,
      industry,
      location,
      designation,
      limit = 50
    } = campaignParams;

    // Apollo uses different parameter names
    return {
      person_titles: designation ? [designation] : [],
      organization_locations: location ? [location] : [],
      organization_industries: industry ? [industry] : [],
      per_page: Math.min(limit, 100),
      page: 1
    };
  }

  /**
   * Map Unipile person object to Apollo format
   * @param {Object} unipilePerson - Unipile person object
   * @returns {Object} Apollo-formatted person
   */
  mapUnipileToApolo(unipilePerson) {
    const person = unipilePerson._unipile_data || unipilePerson;

    return {
      id: person.id || person.public_identifier,
      apollo_id: `unipile_${person.id}`, // Mark source
      name: person.name || '',
      first_name: person.name?.split(' ')[0] || '',
      last_name: person.name?.split(' ').slice(1).join(' ') || '',
      title: person.headline ? person.headline.split(' at ')[0].trim() : null,
      email: null, // Unipile doesn't provide email in search results
      phone: null, // Unipile doesn't provide phone in search results
      phone_numbers: [],
      linkedin_url: person.linkedin_url || person.profile_url || person.public_profile_url || null,
      company_id: null, // Not available in Unipile search
      company_name: null, // Not available in Unipile search
      organization: null,
      country: person.location || null,
      city: null,
      state: null,
      location: {
        country: person.location || null,
        city: null,
        state: null
      },
      network_distance: person.network_distance || null,
      premium: person.premium || false,
      verified: person.verified || false,
      
      // Metadata
      _source: 'unipile',
      _unipile_data: person,
      _enriched_at: new Date().toISOString(),
      _from_free_tier: true
    };
  }

  /**
   * Map Apollo person object to standardized format
   * @param {Object} apolloPerson - Apollo person object
   * @returns {Object} Standardized person object
   */
  mapApolloToStandard(apolloPerson) {
    return {
      id: apolloPerson.id,
      apollo_id: apolloPerson.id,
      name: apolloPerson.name || '',
      first_name: apolloPerson.first_name || '',
      last_name: apolloPerson.last_name || '',
      title: apolloPerson.title || null,
      email: apolloPerson.email || null,
      phone: apolloPerson.phone || null,
      phone_numbers: apolloPerson.phone_numbers || [],
      linkedin_url: apolloPerson.linkedin_url || null,
      company_id: apolloPerson.company_id || null,
      company_name: apolloPerson.company_name || null,
      organization: apolloPerson.organization || null,
      country: apolloPerson.country || null,
      city: apolloPerson.city || null,
      state: apolloPerson.state || null,
      location: apolloPerson.location || {
        country: apolloPerson.country,
        city: apolloPerson.city,
        state: apolloPerson.state
      },
      
      // Metadata
      _source: 'apollo',
      _apollo_data: apolloPerson,
      _enriched_at: new Date().toISOString(),
      _from_free_tier: false
    };
  }

  /**
   * Search for leads using Unipile as primary, Apollo as fallback
   * @param {Object} campaignParams - Campaign parameters
   * @param {string} tenantId - Tenant ID for caching (optional)
   * @param {string} authToken - Auth token (optional)
   * @param {boolean} tryUnipileFirst - Try Unipile before Apollo (default: true)
   * @returns {Promise<Object>} { success, people, count, source, errors }
   */
  async searchLeadsWithFallback(campaignParams, tenantId = null, authToken = null, tryUnipileFirst = true) {
    const results = {
      success: false,
      people: [],
      count: 0,
      source: null,
      sources_tried: [],
      errors: []
    };

    const { accountId } = campaignParams;

    // Try Unipile first if enabled and accountId provided
    if (tryUnipileFirst && accountId) {
      try {
        logger.info('[Unipile-Apollo Adapter] Attempting Unipile search', { accountId });
        
        const unipileParams = this.convertCampaignParamsToUnipile(campaignParams);
        const unipileResult = await UnipileLeadSearchService.searchPeople(unipileParams);
        
        results.sources_tried.push('unipile');

        if (unipileResult.success && unipileResult.people && unipileResult.people.length > 0) {
          logger.info('[Unipile-Apollo Adapter] Unipile search successful', {
            count: unipileResult.people.length,
            accountId
          });

          // Map Unipile results to standardized format
          results.people = unipileResult.people.map(person => this.mapUnipileToApolo(person));
          results.count = results.people.length;
          results.source = 'unipile';
          results.success = true;
          
          return results;
        } else if (!unipileResult.success) {
          logger.warn('[Unipile-Apollo Adapter] Unipile search failed', {
            error: unipileResult.error || 'Unknown error',
            accountId
          });
          results.errors.push({
            source: 'unipile',
            error: unipileResult.error || 'Unipile search failed'
          });
        } else {
          logger.info('[Unipile-Apollo Adapter] Unipile returned no results, trying Apollo fallback');
        }
      } catch (unipileError) {
        logger.error('[Unipile-Apollo Adapter] Unipile search error', {
          error: unipileError.message,
          stack: unipileError.stack,
          accountId
        });
        results.errors.push({
          source: 'unipile',
          error: unipileError.message
        });
      }
    }

    // Fallback to Apollo if Unipile didn't work
    logger.info('[Unipile-Apollo Adapter] Attempting Apollo fallback search', {
      tenantId: tenantId ? tenantId.substring(0, 8) + '...' : 'none'
    });
    try {
      const apolloParams = this.convertCampaignParamsToApollo(campaignParams);
      const apolloResult = await searchEmployeesFromApollo(apolloParams, tenantId);
      
      results.sources_tried.push('apollo');

      if (apolloResult && apolloResult.employees && apolloResult.employees.length > 0) {
        logger.info('[Unipile-Apollo Adapter] Apollo search successful', {
          count: apolloResult.employees.length
        });

        // Map Apollo results to standardized format
        results.people = apolloResult.employees.map(person => this.mapApolloToStandard(person));
        results.count = results.people.length;
        results.source = 'apollo';
        results.success = true;
        
        return results;
      } else {
        logger.warn('[Unipile-Apollo Adapter] Apollo returned no results');
        results.errors.push({
          source: 'apollo',
          error: 'No results from Apollo API'
        });
      }
    } catch (apolloError) {
      logger.error('[Unipile-Apollo Adapter] Apollo search error', {
        error: apolloError.message,
        stack: apolloError.stack
      });
      results.errors.push({
        source: 'apollo',
        error: apolloError.message
      });
    }

    // Both sources failed
    results.success = false;
    results.people = [];
    results.count = 0;
    
    return results;
  }

  /**
   * Search people with source preference
   * @param {Object} campaignParams - Campaign parameters
   * @param {string} preferredSource - 'unipile' or 'apollo'
   * @returns {Promise<Object>} Search results
   */
  async searchLeadsWithSourcePreference(campaignParams, preferredSource = 'unipile') {
    if (preferredSource === 'unipile') {
      return this.searchLeadsWithFallback(campaignParams, true);
    } else {
      return this.searchLeadsWithFallback(campaignParams, false);
    }
  }

  /**
   * Enrich lead with data from both sources
   * @param {Object} lead - Lead object (with id and linkedin_url)
   * @param {string} accountId - Unipile account ID
   * @returns {Promise<Object>} Enriched lead
   */
  async enrichLeadFromBothSources(lead, accountId) {
    const enriched = { ...lead };

    // Try Unipile enrichment first
    if (accountId && lead.linkedin_url) {
      try {
        const linkedinId = this._extractLinkedinId(lead.linkedin_url);
        if (linkedinId) {
          const unipileDetail = await UnipileLeadSearchService.getProfileDetails(
            linkedinId,
            accountId
          );
          
          if (unipileDetail && unipileDetail.success) {
            enriched._unipile_enrichment = unipileDetail.data;
            enriched._enriched_from_unipile = true;
          }
        }
      } catch (error) {
        logger.warn('[Unipile-Apollo Adapter] Unipile enrichment failed', {
          error: error.message,
          lead_id: lead.id
        });
      }
    }

    return enriched;
  }

  /**
   * Extract LinkedIn ID from LinkedIn URL
   * @param {string} linkedinUrl - LinkedIn profile URL
   * @returns {string|null} LinkedIn ID
   */
  _extractLinkedinId(linkedinUrl) {
    if (!linkedinUrl) return null;

    // Try to extract from URL patterns like:
    // - https://www.linkedin.com/in/john-doe
    // - https://www.linkedin.com/in/john-doe/
    // - linkedin.com/in/john-doe?...
    const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?]+)/);
    return match ? match[1] : null;
  }

  /**
   * Get statistics about search sources
   * @returns {Object} Source statistics
   */
  getSourceStats() {
    return {
      unipile: {
        name: 'Unipile (LinkedIn Direct)',
        tier: 'free',
        features: [
          'Direct LinkedIn access',
          'Industry filtering',
          'Location filtering',
          'Job title/designation filtering',
          'Real-time results',
          'No API calls needed'
        ],
        limitations: [
          'No email/phone without separate reveal',
          'Limited historical data'
        ]
      },
      apollo: {
        name: 'Apollo.io',
        tier: 'paid',
        features: [
          'Email addresses included',
          'Phone numbers available',
          'Company details',
          'Technology stack info',
          'Verified contact data',
          'Historical data'
        ],
        limitations: [
          'Requires API credits',
          'Limited free tier'
        ]
      }
    };
  }
}

module.exports = new UnipileApolloAdapterService();
