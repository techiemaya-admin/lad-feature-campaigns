/**
 * LinkedIn Polling Service
 * Business logic for LinkedIn connection polling
 * 
 * LAD Architecture: Service Layer (NO SQL)
 * - Business logic only
 * - Calls repository for data access
 * - Calls unipileService for API integration
 * - Orchestrates polling workflow
 */

const logger = require('../../../core/utils/logger');
const unipileService = require('./unipileService');
const { campaignStatsTracker } = require('./campaignStatsTracker');
const linkedInPollingRepository = require('../repositories/LinkedInPollingRepository');
const pollingConstants = require('../constants/pollingConstants');
const { executeLinkedInStep } = require('./LinkedInStepExecutor');

class LinkedInPollingService {
  /**
   * Poll all active LinkedIn accounts for connection acceptances
   * @param {Object} context - Request context with tenant info
   * @returns {Promise<Object>} Polling results
   */
  async pollAllLinkedInAccounts(context = {}) {
    logger.info('[LinkedInPolling] Starting polling for all accounts');

    try {
      // Get all active LinkedIn accounts (repository handles SQL)
      const accounts = await linkedInPollingRepository.getActiveLinkedInAccounts(context);

      logger.info('[LinkedInPolling] Found accounts to poll', {
        totalAccounts: accounts.length
      });

      if (accounts.length === 0) {
        return {
          success: true,
          total: 0,
          successful: 0,
          failed: 0,
          details: []
        };
      }

      const results = {
        total: accounts.length,
        successful: 0,
        failed: 0,
        details: []
      };

      // Poll each account
      for (const account of accounts) {
        try {
          const accountResult = await this.pollLinkedInConnections(
            account.unipile_account_id,
            account.tenant_id,
            account.account_name,
            context
          );
          
          results.details.push({
            accountId: account.unipile_account_id,
            accountName: account.account_name,
            tenantId: account.tenant_id,
            success: true,
            processed: accountResult.processed || 0
          });
          
          results.successful++;
        } catch (error) {
          logger.error('[LinkedInPolling] Failed to poll account', {
            accountId: account.unipile_account_id,
            error: error.message
          });
          
          results.details.push({
            accountId: account.unipile_account_id,
            accountName: account.account_name,
            tenantId: account.tenant_id,
            success: false,
            error: error.message
          });
          
          results.failed++;
        }
      }

      logger.info('[LinkedInPolling] Polling completed', {
        total: results.total,
        successful: results.successful,
        failed: results.failed
      });

      return {
        success: true,
        ...results
      };
    } catch (error) {
      logger.error('[LinkedInPolling] Polling failed', {
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Poll a single LinkedIn account for connection acceptances
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} tenantId - Tenant ID
   * @param {string} accountName - Account name for logging
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Polling result
   */
  async pollLinkedInConnections(unipileAccountId, tenantId, accountName = 'Unknown', context = {}) {
    logger.info('[LinkedInPolling] Polling account', {
      unipileAccountId,
      tenantId,
      accountName
    });

    try {
      // Call Unipile API to get accepted invitations
      const acceptedInvitations = await this.getAcceptedInvitations(unipileAccountId);
      
      if (!acceptedInvitations || acceptedInvitations.length === 0) {
        logger.info('[LinkedInPolling] No accepted invitations found', {
          unipileAccountId
        });
        return { processed: 0 };
      }

      logger.info('[LinkedInPolling] Retrieved accepted invitations', {
        unipileAccountId,
        count: acceptedInvitations.length
      });

      let processedCount = 0;

      // Process each accepted invitation
      for (const invitation of acceptedInvitations) {
        try {
          const processed = await this.processAcceptedInvitation(
            invitation, 
            unipileAccountId, 
            tenantId,
            accountName,
            context
          );
          if (processed) {
            processedCount++;
          }
        } catch (error) {
          logger.warn('[LinkedInPolling] Failed to process invitation', {
            invitationId: invitation.id,
            error: error.message
          });
        }
      }

      logger.info('[LinkedInPolling] Account polling completed', {
        unipileAccountId,
        processedCount
      });

      return { processed: processedCount };
    } catch (error) {
      logger.error('[LinkedInPolling] Failed to poll account', {
        unipileAccountId,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Get accepted LinkedIn connections from Unipile API
   * Uses /users/relations endpoint which returns actual connections with timestamps
   * @param {string} unipileAccountId - Unipile account ID
   * @param {number} sinceTimestamp - Optional timestamp to filter connections (milliseconds)
   * @returns {Promise<Array>} List of recently accepted connections
   */
  async getAcceptedInvitations(unipileAccountId, sinceTimestamp = null) {
    try {
      // Get Unipile configuration
      const baseUrl = process.env.UNIPILE_API_URL || 'https://api8.unipile.com:13811/api/v1';
      const token = process.env.UNIPILE_TOKEN;
      
      if (!token) {
        throw new Error('UNIPILE_TOKEN not configured');
      }
      
      // Calculate default lookback period (24 hours) if no timestamp provided
      if (!sinceTimestamp) {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        sinceTimestamp = oneDayAgo;
      }
      
      // Call /users/relations endpoint to get all connections
      const axios = require('axios');
      const response = await axios.get(`${baseUrl}/users/relations`, {
        params: {
          account_id: unipileAccountId,
          limit: 100  // Get up to 100 connections
        },
        headers: {
          'X-API-KEY': token,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        timeout: 30000
      });

      // Response format: { items: [ { object, connection_urn, created_at, member_id, public_profile_url } ] }
      const relations = response.data.items || [];
      
      // Filter for recently added connections (created_at is in milliseconds)
      const recentConnections = relations.filter(rel => {
        return rel.created_at && rel.created_at >= sinceTimestamp;
      });
      
      logger.info('[LinkedInPolling] Retrieved LinkedIn connections', {
        unipileAccountId,
        totalConnections: relations.length,
        recentCount: recentConnections.length,
        sinceDate: new Date(sinceTimestamp).toISOString()
      });

      return recentConnections;
      
    } catch (error) {
      logger.error('[LinkedInPolling] Failed to get connections from Unipile', {
        unipileAccountId,
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Process a single accepted connection
   * @param {Object} connection - Connection data from Unipile (/users/relations)
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} tenantId - Tenant ID
   * @param {string} accountName - Account name
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} True if processed, false if skipped
   */
  async processAcceptedInvitation(connection, unipileAccountId, tenantId, accountName, context = {}) {
    // Connection structure: { connection_urn, created_at, member_id, public_profile_url, first_name, last_name }
    
    if (!connection.public_profile_url) {
      logger.warn('[LinkedInPolling] No public_profile_url in connection', {
        connectionUrn: connection.connection_urn,
        memberId: connection.member_id
      });
      return false;
    }

    logger.debug('[LinkedInPolling] Processing accepted connection', {
      connectionUrn: connection.connection_urn,
      memberId: connection.member_id,
      createdAt: new Date(connection.created_at).toISOString(),
      profileUrl: connection.public_profile_url
    });

    try {
      // Normalize LinkedIn URL
      const normalizedUrl = this.normalizeLinkedInUrl(connection.public_profile_url);

      logger.debug('[LinkedInPolling] Got recipient LinkedIn URL', {
        memberId: connection.member_id,
        linkedinUrl: normalizedUrl
      });

      // Find the original CONNECTION_SENT record by LinkedIn URL (using lead_linkedin column)
      const sentRecord = await linkedInPollingRepository.getConnectionSentRecordByLinkedInUrl(
        tenantId,
        normalizedUrl,
        context
      );

      if (!sentRecord) {
        logger.debug('[LinkedInPolling] No matching CONNECTION_SENT record found', {
          linkedinUrl: normalizedUrl
        });
        return false;
      }

      logger.info('[LinkedInPolling] Found matching campaign lead', {
        campaignId: sentRecord.campaign_id,
        leadId: sentRecord.lead_id,
        leadLinkedIn: sentRecord.lead_linkedin
      });

      // Check if we already recorded this acceptance
      const alreadyRecorded = await linkedInPollingRepository.hasConnectionAcceptanceRecord(
        sentRecord.tenant_id,
        sentRecord.campaign_id,
        sentRecord.lead_id,
        context
      );

      if (alreadyRecorded) {
        logger.debug('[LinkedInPolling] Connection acceptance already recorded', {
          campaignId: sentRecord.campaign_id,
          leadId: sentRecord.lead_id
        });
        return false;
      }

      // Record CONNECTION_ACCEPTED
      await this.recordConnectionAcceptance(
        sentRecord,
        connection,
        unipileAccountId,
        accountName,
        normalizedUrl,
        context
      );

      return true;

    } catch (error) {
      logger.error('[LinkedInPolling] Failed to process connection', {
        connectionUrn: connection.connection_urn,
        memberId: connection.member_id,
        error: error.message
      });
      return false;  // Don't throw, just skip this connection
    }
  }

  /**
   * Record connection acceptance in campaign_analytics
   * @param {Object} sentRecord - Campaign analytics sentrecord (CONNECTION_SENT)
   * @param {Object} connection - Connection data from Unipile (/users/relations)
   * @param {string} unipileAccountId - Unipile account ID
   * @param {string} accountName - Account name
   * @param {string} normalizedLinkedInUrl - Normalized LinkedIn URL
   * @param {Object} context - Request context
   */
  async recordConnectionAcceptance(sentRecord, connection, unipileAccountId, accountName, normalizedLinkedInUrl, context = {}) {
    try {
      // sentRecord already contains the CONNECTION_SENT record with tenant_id, campaign_id, lead_id
      const tenantId = sentRecord.tenant_id;
      const campaignId = sentRecord.campaign_id;
      const leadId = sentRecord.lead_id;

      // Check if we already recorded this acceptance
      const alreadyRecorded = await linkedInPollingRepository.hasConnectionAcceptanceRecord(
        tenantId,
        campaignId,
        leadId,
        context
      );

      if (alreadyRecorded) {
        logger.debug('[LinkedInPolling] Connection acceptance already recorded', {
          tenantId,
          campaignId,
          leadId
        });
        return;
      }

      // Extract lead name from connection
      const leadName = `${connection.first_name || ''} ${connection.last_name || ''}`.trim() 
        || 'Unknown';

      // ✅ Record CONNECTION_ACCEPTED with ALL 4 new tracking columns
      // Use account info from CONNECTION_SENT record for consistency
      await campaignStatsTracker.trackAction(
        campaignId,
        pollingConstants.ACTION_TYPES.CONNECTION_ACCEPTED,
        {
          tenantId,
          leadId,
          status: 'success',
          accountName: sentRecord.account_name || accountName,
          providerAccountId: sentRecord.provider_account_id || unipileAccountId,
          leadLinkedIn: normalizedLinkedInUrl
        }
      );

      logger.info('[LinkedInPolling] Recording CONNECTION_ACCEPTED', {
        campaignId: campaignId,
        leadId: leadId,
        tenantId: tenantId,
        leadName: leadName,
        accountName: sentRecord.account_name || accountName,
        providerAccountId: sentRecord.provider_account_id || unipileAccountId,
        leadLinkedIn: normalizedLinkedInUrl,
        connectionCreatedAt: new Date(connection.created_at).toISOString()
      });

      // ✅ NEW: Immediately trigger message sending if there's a skipped message
      await this.triggerMessageSendingIfSkipped(
        campaignId,
        leadId,
        tenantId,
        normalizedLinkedInUrl,
        context
      );

      // Update campaign lead status (optional - only if campaign_leads exists)
      // await linkedInPollingRepository.updateCampaignLeadStatus(
      //   leadId,
      //   tenantId,
      //   'in_progress',
      //   context
      // );

    } catch (error) {
      logger.error('[LinkedInPolling] Failed to record connection acceptance', {
        tenantId: sentRecord.tenant_id,
        connectionUrn: connection.connection_urn,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Normalize LinkedIn URL for consistent matching
   * @param {string} url - LinkedIn URL
   * @returns {string} Normalized URL
   */
  normalizeLinkedInUrl(url) {
    if (!url) return '';
    
    let normalized = url.trim();
    
    // Ensure https
    if (!normalized.startsWith('http')) {
      normalized = 'https://' + normalized;
    }
    
    // Convert http to https
    normalized = normalized.replace('http://', 'https://');
    
    // Remove query parameters and fragments
    normalized = normalized.split('?')[0].split('#')[0];
    
    return normalized;
  }

  /**
   * Check if a specific lead is connected
   * @param {string} campaignLeadId - Campaign lead ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<boolean>} True if connected
   */
  async isLeadConnected(campaignLeadId, tenantId, context = {}) {
    try {
      return await linkedInPollingRepository.isLeadConnected(campaignLeadId, tenantId, context);
    } catch (error) {
      logger.error('[LinkedInPolling] Failed to check lead connection status', {
        campaignLeadId,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Poll connections for a specific tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Polling results
   */
  async pollTenantLinkedInConnections(tenantId, context = {}) {
    logger.info('[LinkedInPolling] Starting tenant-specific polling', { tenantId });

    try {
      // Get LinkedIn accounts for this tenant
      const accounts = await linkedInPollingRepository.getLinkedInAccountsByTenant(tenantId, context);

      if (accounts.length === 0) {
        logger.warn('[LinkedInPolling] No LinkedIn accounts found for tenant', { tenantId });
        return {
          success: true,
          total: 0,
          successful: 0,
          failed: 0,
          details: []
        };
      }

      const results = {
        total: accounts.length,
        successful: 0,
        failed: 0,
        details: []
      };

      // Poll each account
      for (const account of accounts) {
        try {
          const accountResult = await this.pollLinkedInConnections(
            account.unipile_account_id,
            account.tenant_id,
            account.account_name,
            context
          );
          
          results.details.push({
            accountId: account.unipile_account_id,
            accountName: account.account_name,
            success: true,
            processed: accountResult.processed || 0
          });
          
          results.successful++;
        } catch (error) {
          logger.error('[LinkedInPolling] Failed to poll account', {
            accountId: account.unipile_account_id,
            error: error.message
          });
          
          results.details.push({
            accountId: account.unipile_account_id,
            accountName: account.account_name,
            success: false,
            error: error.message
          });
          
          results.failed++;
        }
      }

      logger.info('[LinkedInPolling] Tenant polling completed', {
        tenantId,
        total: results.total,
        successful: results.successful,
        failed: results.failed
      });

      return {
        success: true,
        ...results
      };
    } catch (error) {
      logger.error('[LinkedInPolling] Tenant polling failed', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Trigger message sending immediately if there's a skipped message waiting
   * Called automatically after CONNECTION_ACCEPTED is recorded
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {string} tenantId - Tenant ID
   * @param {string} linkedInUrl - LinkedIn profile URL
   * @param {Object} context - Request context
   */
  async triggerMessageSendingIfSkipped(campaignId, leadId, tenantId, linkedInUrl, context = {}) {
    try {
      logger.info('[LinkedInPolling] Checking for skipped messages', {
        campaignId,
        leadId,
        tenantId
      });

      // 1. Check if there's a MESSAGE_SKIPPED record for this lead
      const skippedMessage = await linkedInPollingRepository.getSkippedMessage(
        campaignId,
        leadId,
        tenantId,
        context
      );

      if (!skippedMessage) {
        logger.debug('[LinkedInPolling] No skipped message found - message step may not have been reached yet', {
          campaignId,
          leadId
        });
        return;
      }

      logger.info('[LinkedInPolling] Found skipped message - triggering immediate send', {
        campaignId,
        leadId,
        skippedAt: skippedMessage.created_at
      });

      // 2. Get campaign data
      const campaign = await linkedInPollingRepository.getCampaign(
        campaignId,
        tenantId,
        context
      );

      if (!campaign) {
        logger.warn('[LinkedInPolling] Campaign not found', { campaignId, tenantId });
        return;
      }

      // 3. Get campaign_lead data
      const campaignLead = await linkedInPollingRepository.getCampaignLeadWithDetails(
        campaignId,
        leadId,
        tenantId,
        context
      );

      if (!campaignLead) {
        logger.warn('[LinkedInPolling] Campaign lead not found', { campaignId, leadId });
        return;
      }

      // 4. Get the linkedin_message step from workflow steps
      const messageStep = await linkedInPollingRepository.getLinkedInMessageStep(
        campaignId,
        context
      );

      if (!messageStep) {
        logger.warn('[LinkedInPolling] No linkedin_message step found in campaign', { campaignId });
        return;
      }

      // 5. Execute the message step immediately
      logger.info('[LinkedInPolling] Executing linkedin_message step immediately', {
        campaignId,
        leadId,
        stepId: messageStep.id,
        linkedInUrl: linkedInUrl
      });

      const result = await executeLinkedInStep(
        campaign,
        messageStep,
        campaignLead,
        tenantId,
        context
      );

      if (result.success) {
        logger.info('[LinkedInPolling] ✅ Message sent successfully immediately after connection acceptance!', {
          campaignId,
          leadId,
          linkedInUrl: linkedInUrl
        });
      } else if (result.skipped) {
        logger.warn('[LinkedInPolling] Message still skipped (unexpected)', {
          campaignId,
          leadId,
          error: result.error
        });
      } else {
        logger.error('[LinkedInPolling] Failed to send message', {
          campaignId,
          leadId,
          error: result.error
        });
      }

    } catch (error) {
      // Don't throw error - this is a bonus feature, shouldn't break polling
      logger.error('[LinkedInPolling] Failed to trigger message sending', {
        campaignId,
        leadId,
        error: error.message,
        stack: error.stack
      });
    }
  }
}

module.exports = new LinkedInPollingService();
