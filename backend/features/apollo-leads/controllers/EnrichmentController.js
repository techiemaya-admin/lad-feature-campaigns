/**
 * Apollo Enrichment Controller
 * LAD Architecture: Handles on-demand enrichment of leads
 * 
 * Enriches leads with email and LinkedIn URL when user interacts with them
 */

const logger = require('../../../core/utils/logger');
const { getSchema } = require('../../../core/utils/schemaHelper');
const { requireTenantId } = require('../../../core/utils/tenantHelper');
const ApolloRevealService = require('../services/ApolloRevealService');
const CampaignLeadRepository = require('../../campaigns/repositories/CampaignLeadRepository');
const { pool } = require('../../../shared/database/connection');

class EnrichmentController {
  /**
   * Enrich a single lead with email and LinkedIn URL
   * Called when user clicks on email unlock or LinkedIn URL
   * 
   * POST /api/apollo/enrichment/lead/:leadId
   * Body: { personId, name }
   */
  async enrichLead(req, res) {
    try {
      const { leadId } = req.params;
      let { personId, name } = req.body;
      const tenantId = requireTenantId(null, req, 'enrichLead');
      const schema = getSchema(req);

      // If personId not provided, fetch from campaign_lead's lead_data JSONB
      if (!personId) {
        logger.info('[Enrichment] Fetching apollo_person_id from campaign_lead', { leadId });
        
        const query = `
          SELECT 
            lead_data->>'apollo_person_id' as apollo_person_id,
            lead_data->>'name' as name,
            email,
            company_name
          FROM ${schema}.campaign_leads
          WHERE id = $1 AND tenant_id = $2
        `;
        
        const result = await pool.query(query, [leadId, tenantId]);
        
        if (result.rows.length === 0) {
          logger.warn('[Enrichment] Campaign lead not found', { leadId, tenantId: tenantId.substring(0, 8) + '...' });
          return res.status(404).json({ error: 'Lead not found' });
        }

        const leadData = result.rows[0];
        personId = leadData.apollo_person_id;
        name = name || leadData.name;

        if (!personId) {
          logger.warn('[Enrichment] Lead has no apollo_person_id', { leadId, name });
          return res.status(400).json({ error: 'Lead does not have apollo_person_id for enrichment' });
        }

        logger.info('[Enrichment] Retrieved apollo_person_id from lead', {
          leadId,
          personId,
          name: name ? name.substring(0, 20) : 'Unknown'
        });
      }

      logger.info('[Enrichment] Lead enrichment requested', {
        leadId,
        personId,
        name,
        tenantId: tenantId.substring(0, 8) + '...'
      });

      // Create reveal service
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        logger.error('[Enrichment] Apollo API key not configured');
        return res.status(500).json({ error: 'Apollo API not configured' });
      }

      const revealService = new ApolloRevealService(apiKey, 'https://api.apollo.io/v1');

      // Call enrichment API
      const enrichResult = await revealService.revealEmail(personId, name, req, tenantId);

      if (enrichResult.email) {
        logger.info('[Enrichment] Lead enriched successfully', {
          leadId,
          personId,
          hasEmail: !!enrichResult.email,
          hasLinkedIn: !!enrichResult.linkedin_url,
          creditsUsed: enrichResult.credits_used
        });

        // Save enriched data to database
        try {
          await CampaignLeadRepository.updateEnrichedData(
            leadId,
            enrichResult.email,
            enrichResult.linkedin_url,
            tenantId,
            schema
          );

          logger.info('[Enrichment] Enriched data saved to database', {
            leadId,
            hasEmail: !!enrichResult.email,
            hasLinkedIn: !!enrichResult.linkedin_url
          });
        } catch (saveError) {
          logger.error('[Enrichment] Failed to save enriched data to database', {
            leadId,
            error: saveError.message
          });
          // Don't fail the response - enrichment API succeeded even if DB save fails
        }

        return res.json({
          success: true,
          data: {
            email: enrichResult.email,
            linkedin_url: enrichResult.linkedin_url,
            from_cache: enrichResult.from_cache,
            credits_used: enrichResult.credits_used
          }
        });
      } else {
        logger.warn('[Enrichment] Enrichment returned no email', {
          leadId,
          personId,
          error: enrichResult.error
        });

        return res.status(200).json({
          success: false,
          error: enrichResult.error || 'Unable to retrieve email for this person'
        });
      }
    } catch (error) {
      logger.error('[Enrichment] Error enriching lead', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        error: 'Failed to enrich lead',
        message: error.message
      });
    }
  }

  /**
   * Enrich multiple leads in batch
   * Called for batch enrichment of visible leads
   * 
   * POST /api/apollo/enrichment/batch
   * Body: { leads: [{ leadId, personId, name }, ...] }
   */
  async enrichLeadsBatch(req, res) {
    try {
      const { leads } = req.body;
      const tenantId = requireTenantId(null, req, 'enrichLeadsBatch');
      const schema = getSchema(req);

      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return res.status(400).json({ error: 'leads array is required' });
      }

      logger.info('[Enrichment] Batch enrichment requested', {
        leadsCount: leads.length,
        tenantId: tenantId.substring(0, 8) + '...'
      });

      // Create reveal service
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        logger.error('[Enrichment] Apollo API key not configured');
        return res.status(500).json({ error: 'Apollo API not configured' });
      }

      const revealService = new ApolloRevealService(apiKey, 'https://api.apollo.io/v1');

      const results = [];
      const enrichmentDelayMs = parseInt(process.env.APOLLO_ENRICHMENT_DELAY_MS || '200', 10);

      for (const lead of leads) {
        try {
          let { leadId, personId, name } = lead;

          // If personId not provided, fetch from campaign_lead's lead_data JSONB
          if (!personId) {
            const query = `
              SELECT 
                lead_data->>'apollo_person_id' as apollo_person_id,
                lead_data->>'name' as name
              FROM ${schema}.campaign_leads
              WHERE id = $1 AND tenant_id = $2
            `;
            
            const result = await pool.query(query, [leadId, tenantId]);
            
            if (result.rows.length === 0) {
              results.push({
                leadId,
                success: false,
                error: 'Lead not found'
              });
              continue;
            }

            const leadData = result.rows[0];
            personId = leadData.apollo_person_id;
            name = name || leadData.name;

            if (!personId) {
              results.push({
                leadId,
                success: false,
                error: 'Lead does not have apollo_person_id'
              });
              continue;
            }
          }

          // Call enrichment API
          const enrichResult = await revealService.revealEmail(personId, name, req, tenantId);

          if (enrichResult.email) {
            // Save enriched data to database
            try {
              await CampaignLeadRepository.updateEnrichedData(
                leadId,
                enrichResult.email,
                enrichResult.linkedin_url,
                tenantId,
                schema
              );
            } catch (saveError) {
              logger.error('[Enrichment] Failed to save enriched data for lead in batch', {
                leadId,
                error: saveError.message
              });
              // Continue processing - don't fail entire batch
            }

            results.push({
              leadId,
              success: true,
              email: enrichResult.email,
              linkedin_url: enrichResult.linkedin_url,
              from_cache: enrichResult.from_cache,
              credits_used: enrichResult.credits_used
            });
          } else {
            results.push({
              leadId,
              success: false,
              error: enrichResult.error || 'No email available'
            });
          }

          // Rate limiting
          if (results.length < leads.length) {
            await new Promise(resolve => setTimeout(resolve, enrichmentDelayMs));
          }
        } catch (leadError) {
          results.push({
            leadId: lead.leadId,
            success: false,
            error: leadError.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      logger.info('[Enrichment] Batch enrichment completed', {
        totalRequested: leads.length,
        successCount,
        failureCount
      });

      return res.json({
        success: true,
        data: {
          total: results.length,
          succeeded: successCount,
          failed: failureCount,
          results
        }
      });
    } catch (error) {
      logger.error('[Enrichment] Error in batch enrichment', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        error: 'Failed to perform batch enrichment',
        message: error.message
      });
    }
  }
}

module.exports = new EnrichmentController();
