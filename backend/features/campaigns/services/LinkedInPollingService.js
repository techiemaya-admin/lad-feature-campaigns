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

class LinkedInPollingService {
  /**
   * Poll all tenants for LinkedIn connection acceptances (multi-tenant orchestration)
   * Used by cron scheduler - iterates through tenants in tenant-scoped manner
   * ARCHITECTURE COMPLIANCE: Gets tenant list, then calls tenant-scoped polling for each
   * This ensures ALL data queries have WHERE tenant_id = $1 filter
   * @param {Object} context - Optional request context
   * @returns {Promise<Object>} Polling results
   */
  async pollAllLinkedInAccounts(context = {}) {
    logger.info('[LinkedInPolling] Starting multi-tenant polling orchestration');

    try {
      // Step 1: Get list of tenants that have active LinkedIn accounts
      // This is a metadata query (tenant IDs only), not tenant data
      const tenantIds = await linkedInPollingRepository.getTenantsWithActiveLinkedInAccounts(context);

      logger.info('[LinkedInPolling] Found tenants with LinkedIn accounts', {
        tenantCount: tenantIds.length
      });

      if (tenantIds.length === 0) {
        return {
          success: true,
          total: 0,
          tenantsPolled: 0,
          successful: 0,
          failed: 0,
          details: []
        };
      }

      const results = {
        tenantsPolled: tenantIds.length,
        successful: 0,
        failed: 0,
        details: []
      };

      // Step 2: Poll each tenant individually with full tenant isolation
      // Each call to pollTenantLinkedInConnections uses tenant-scoped queries
      for (const tenantId of tenantIds) {
        try {
          logger.info('[LinkedInPolling] Polling tenant', { tenantId });
          
          const tenantResult = await this.pollTenantLinkedInConnections(tenantId, context);
          
          results.details.push({
            tenantId,
            success: true,
            accountsPolled: tenantResult.total,
            accountsSuccessful: tenantResult.successful,
            accountsFailed: tenantResult.failed
          });
          
          results.successful++;
        } catch (error) {
          logger.error('[LinkedInPolling] Failed to poll tenant', {
            tenantId,
            error: error.message
          });
          
          results.details.push({
            tenantId,
            success: false,
            error: error.message
          });
          
          results.failed++;
        }
      }

      logger.info('[LinkedInPolling] Multi-tenant polling completed', {
        tenantsPolled: results.tenantsPolled,
        successful: results.successful,
        failed: results.failed
      });

      return {
        success: true,
        ...results
      };
    } catch (error) {
      logger.error('[LinkedInPolling] Multi-tenant polling orchestration failed', {
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Poll connections for a specific tenant (fully tenant-scoped)
   * @param {string} tenantId - Tenant ID (required)
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Polling results
   */
  async pollTenantLinkedInConnections(tenantId, context = {}) {
    if (!tenantId) {
      throw new Error('[LinkedInPolling] Tenant ID is required for polling');
    }
    
    logger.info('[LinkedInPolling] Starting tenant-specific polling', { tenantId });

    try {
      // Get LinkedIn accounts for this tenant (tenant-scoped query)
      const accounts = await linkedInPollingRepository.getActiveLinkedInAccounts(tenantId, context);

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

      // ⚠️ CRITICAL: Must have provider_account_id (unique identifier)
      // Note: account_name can vary (e.g., "Sathwik Reddy" vs "sathwik492@gmail.com")
      // so we only require provider_account_id - account_name is optional for display
      if (!sentRecord.provider_account_id) {
        logger.error('[LinkedInPolling] Missing provider_account_id in CONNECTION_SENT record - cannot proceed', {
          campaignId,
          leadId,
          leadLinkedIn: normalizedLinkedInUrl
        });
        return false;
      }

      // Use account_name from sentRecord if available, else use placeholder
      const recordAccountName = sentRecord.account_name || 'Unknown Account';

      // ✅ Record CONNECTION_ACCEPTED with account that sent the request
      await campaignStatsTracker.trackAction(
        campaignId,
        pollingConstants.ACTION_TYPES.CONNECTION_ACCEPTED,
        {
          tenantId,
          leadId,
          status: 'success',
          leadName: leadName,
          accountName: recordAccountName,  // ✅ From CONNECTION_SENT (may vary)
          providerAccountId: sentRecord.provider_account_id,  // ✅ Sender's Unipile account ID
          userId: sentRecord.user_id || null,  // ✅ User ID from CONNECTION_SENT record
          leadLinkedIn: normalizedLinkedInUrl
        }
      );

      logger.info('[LinkedInPolling] Recording CONNECTION_ACCEPTED', {
        campaignId: campaignId,
        leadId: leadId,
        tenantId: tenantId,
        leadName: leadName,
        accountName: recordAccountName,
        providerAccountId: sentRecord.provider_account_id,
        leadLinkedIn: normalizedLinkedInUrl,
        connectionCreatedAt: new Date(connection.created_at).toISOString()
      });

      // 🚀 IMMEDIATELY send message after connection accepted (don't wait for next campaign run)
      try {
        logger.info('[LinkedInPolling] Triggering immediate message sending after connection acceptance', {
          campaignId,
          leadId,
          tenantId,
          leadName,
          accountName: recordAccountName,
          providerAccountId: sentRecord.provider_account_id,
          recipientProviderId: connection.member_id
        });
        
        // ✅ Pass the SAME provider_account_id that sent the connection
        await this.sendImmediateMessageAfterAcceptance(
          campaignId,
          leadId,
          tenantId,
          sentRecord,
          sentRecord.provider_account_id,  // ✅ CRITICAL: Use account from CONNECTION_SENT, NOT current polling account
          { 
            ...context, 
            leadName, 
            normalizedLinkedInUrl,
            recipientProviderId: connection.member_id  // Pass recipient's provider ID for first message
          }
        );
      } catch (msgError) {
        logger.error('[LinkedInPolling] Failed to send immediate message after acceptance', {
          campaignId,
          leadId,
          error: msgError.message,
          stack: msgError.stack
        });
        
        // Store error in response_data for debugging
        try {
          await campaignStatsTracker.trackAction(
            campaignId,
            'IMMEDIATE_MESSAGE_FAILED',
            {
              tenantId,
              leadId,
              status: 'failed',
              leadName: leadName,
              errorMessage: msgError.message,
              responseData: JSON.stringify({
                error: msgError.message,
                stack: msgError.stack,
                timestamp: new Date().toISOString()
              }),
              accountName: recordAccountName,  // ✅ From CONNECTION_SENT (may vary)
              providerAccountId: sentRecord.provider_account_id,  // ✅ Sender's Unipile account ID
              userId: sentRecord.user_id || null,  // ✅ User ID from CONNECTION_SENT record
              leadLinkedIn: normalizedLinkedInUrl
            }
          );
        } catch (trackError) {
          logger.error('[LinkedInPolling] Failed to track immediate message error', { trackError: trackError.message });
        }
        
        // Don't throw - connection acceptance is already recorded
      }

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
   * Send immediate message after connection acceptance
   * @param {string} campaignId - Campaign ID
   * @param {string} leadId - Lead ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} sentRecord - Original CONNECTION_SENT record
   * @param {string} senderAccountId - Unipile account ID that sent the connection (MUST be from sentRecord)
   * @param {Object} context - Request context
   */
  async sendImmediateMessageAfterAcceptance(campaignId, leadId, tenantId, sentRecord, senderAccountId, context = {}) {
    try {
      const { pool } = require('../../../shared/database/connection');
      const { getSchema } = require('../../../core/utils/schemaHelper');
      const unipileService = require('./unipileService');
      
      const schema = getSchema({ user: { tenant_id: tenantId } });
      
      // ⚠️ CRITICAL VALIDATION: Must have provider_account_id from CONNECTION_SENT
      if (!senderAccountId) {
        logger.error('[LinkedInPolling] Cannot send message - missing provider_account_id from CONNECTION_SENT', {
          campaignId,
          leadId,
          tenantId
        });
        return { success: false, error: 'Missing provider_account_id - cannot send message' };
      }

      // 🎯 SMART ACCOUNT SELECTION LOGIC:
      // 1. Check if original account (from CONNECTION_SENT) is still active
      // 2. If not active, find another ACTIVE account for the same user_id
      // 3. This provides automatic failover while maintaining security
      
      logger.info('[LinkedInPolling] Finding active account for message sending', {
        campaignId,
        leadId,
        tenantId,
        originalAccountId: senderAccountId
      });
      
      // Step 1: Get the original account and its user_id
      const originalAccountQuery = `
        SELECT id, account_name, provider_account_id, status, is_deleted, user_id
        FROM ${schema}.social_linkedin_accounts
        WHERE tenant_id = $1
          AND provider_account_id = $2
          AND provider = 'unipile'
      `;
      
      const originalAccountResult = await pool.query(originalAccountQuery, [tenantId, senderAccountId]);
      
      if (originalAccountResult.rows.length === 0) {
        logger.error('[LinkedInPolling] Original account not found in social_linkedin_accounts', {
          campaignId,
          leadId,
          tenantId,
          originalAccountId: senderAccountId
        });
        return { success: false, error: 'Original account not found - cannot send message' };
      }
      
      const originalAccount = originalAccountResult.rows[0];
      const userId = originalAccount.user_id;
      
      logger.info('[LinkedInPolling] Original account found', {
        accountName: originalAccount.account_name,
        userId: userId,
        status: originalAccount.status,
        isDeleted: originalAccount.is_deleted
      });
      
      // Step 2: Check if original account is active
      let accountData;
      let actualSenderAccountId;
      
      if (originalAccount.status === 'active' && originalAccount.is_deleted === false) {
        // ✅ Original account is active - use it
        accountData = originalAccount;
        actualSenderAccountId = senderAccountId;
        
        logger.info('[LinkedInPolling] Using original account - it is active', {
          accountName: accountData.account_name,
          provider_account_id: actualSenderAccountId
        });
      } else {
        // ⚠️ Original account is NOT active - find another active account for same user_id
        logger.warn('[LinkedInPolling] Original account is not active - searching for alternate active account', {
          originalAccountName: originalAccount.account_name,
          originalStatus: originalAccount.status,
          userId: userId
        });
        
        const alternateAccountQuery = `
          SELECT id, account_name, provider_account_id, status, is_deleted, user_id
          FROM ${schema}.social_linkedin_accounts
          WHERE tenant_id = $1
            AND user_id = $2
            AND provider = 'unipile'
            AND status = 'active'
            AND is_deleted = false
            AND provider_account_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `;
        
        const alternateAccountResult = await pool.query(alternateAccountQuery, [tenantId, userId]);
        
        if (alternateAccountResult.rows.length === 0) {
          logger.error('[LinkedInPolling] No active account found for this user', {
            campaignId,
            leadId,
            tenantId,
            userId: userId,
            originalAccountName: originalAccount.account_name,
            originalStatus: originalAccount.status
          });
          return { 
            success: false, 
            error: `No active LinkedIn account found for user. Original account '${originalAccount.account_name}' is ${originalAccount.status}` 
          };
        }
        
        accountData = alternateAccountResult.rows[0];
        actualSenderAccountId = accountData.provider_account_id;
        
        logger.info('[LinkedInPolling] ✅ Found alternate active account - using it instead', {
          originalAccount: originalAccount.account_name,
          originalStatus: originalAccount.status,
          alternateAccount: accountData.account_name,
          alternateStatus: accountData.status,
          provider_account_id: actualSenderAccountId
        });
      }
      
      logger.info('[LinkedInPolling] Account verification passed - starting immediate message sending', {
        campaignId,
        leadId,
        tenantId,
        accountName: accountData.account_name,
        userId: accountData.user_id,
        accountStatus: accountData.status,
        senderAccountId: actualSenderAccountId,
        usingAlternate: actualSenderAccountId !== senderAccountId
      });
      
      // Get campaign details and config
      const campaignResult = await pool.query(
        `SELECT id, name, config, created_by, status FROM ${schema}.campaigns WHERE id = $1 AND tenant_id = $2`,
        [campaignId, tenantId]
      );
      
      if (campaignResult.rows.length === 0) {
        logger.warn('[LinkedInPolling] Campaign not found for immediate messaging', { campaignId, tenantId });
        return { success: false, error: 'Campaign not found' };
      }
      
      const campaign = campaignResult.rows[0];
      
      // Check if campaign has a connectionMessage configured
      if (!campaign.config || !campaign.config.connectionMessage) {
        logger.info('[LinkedInPolling] No connectionMessage configured in campaign', { campaignId });
        return { success: false, error: 'No connectionMessage configured' };
      }
      
      const messageTemplate = campaign.config.connectionMessage;
      
      logger.info('[LinkedInPolling] Found connectionMessage', {
        campaignId,
        messagePreview: messageTemplate.substring(0, 50) + '...'
      });
      
      // Get LinkedIn URL from sentRecord or use the normalizedLinkedInUrl passed in context
      const linkedInUrl = sentRecord.lead_linkedin || context.normalizedLinkedInUrl;
      const leadName = context.leadName || sentRecord.lead_name || '';
      
      if (!linkedInUrl) {
        logger.warn('[LinkedInPolling] No LinkedIn URL in sentRecord', { campaignId, leadId });
        return { success: false, error: 'No LinkedIn URL provided' };
      }
      
      // Try to find lead in campaign_leads by LinkedIn URL or name
      // Note: lead_data may not have 'linkedin' field, so we also try matching by name
      let leadResult = null;
      let campaignLead = null;
      let leadData = null;
      
      // Attempt 1: Try to find by LinkedIn URL (if stored in lead_data)
      leadResult = await pool.query(
        `SELECT id, campaign_id, lead_data, status, tenant_id 
         FROM ${schema}.campaign_leads 
         WHERE campaign_id = $1 
           AND tenant_id = $2
           AND (
             lead_data->>'linkedin' = $3 OR
             LOWER(REGEXP_REPLACE(TRIM(lead_data->>'linkedin'), '^https?://|/$', '', 'g')) = 
             LOWER(REGEXP_REPLACE(TRIM($3), '^https?://|/$', '', 'g'))
           )`,
        [campaignId, tenantId, linkedInUrl]
      );
      
      if (leadResult.rows.length > 0) {
        campaignLead = leadResult.rows[0];
        leadData = campaignLead.lead_data || {};
        logger.info('[LinkedInPolling] Found lead by LinkedIn URL', {
          leadId: campaignLead.id,
          leadName: leadData.fullname || leadData.name
        });
      } else if (leadName) {
        // Attempt 2: Try to find by name (fallback)
        const firstName = leadName.split(' ')[0];
        leadResult = await pool.query(
          `SELECT id, campaign_id, lead_data, status, tenant_id 
           FROM ${schema}.campaign_leads 
           WHERE campaign_id = $1 
             AND tenant_id = $2
             AND (
               lead_data->>'first_name' ILIKE $3 OR
               lead_data->>'name' ILIKE $3
             )
           LIMIT 1`,
          [campaignId, tenantId, firstName]
        );
        
        if (leadResult.rows.length > 0) {
          campaignLead = leadResult.rows[0];
          leadData = campaignLead.lead_data || {};
          logger.info('[LinkedInPolling] Found lead by name match', {
            leadId: campaignLead.id,
            leadName: leadData.fullname || leadData.name,
            matchedName: firstName
          });
        }
      }
      
      if (!campaignLead) {
        // Attempt 3: Use data from CONNECTION_ACCEPTED record (fallback)
        logger.warn('[LinkedInPolling] Lead not found in campaign_leads, using connection data', { 
          campaignId, 
          linkedInUrl,
          leadName
        });
        
        // Create synthetic lead data from connection info
        leadData = {
          fullname: leadName,
          first_name: leadName.split(' ')[0],
          last_name: leadName.split(' ').slice(1).join(' '),
          linkedin: linkedInUrl,
          company: '', // Not available
          title: '' // Not available
        };
      }
      
      // IMPORTANT: Always use the leadId parameter (from leads table), NOT campaignLead.id (from campaign_leads table)
      // The campaign_analytics.lead_id has a foreign key to leads.id, not campaign_leads.id
      const correctLeadId = leadId;
      
      logger.info('[LinkedInPolling] Preparing to send message', {
        campaignId,
        leadId: correctLeadId,
        leadName: leadData.fullname || leadData.name || leadName,
        hasLeadInCampaignLeads: !!campaignLead
      });
      
      // Replace variables in message template
      let personalizedMessage = messageTemplate;
      personalizedMessage = personalizedMessage.replace(/\{\{first_name\}\}/gi, leadData.first_name || leadData.fullname?.split(' ')[0] || '');
      personalizedMessage = personalizedMessage.replace(/\{\{last_name\}\}/gi, leadData.last_name || leadData.fullname?.split(' ').slice(1).join(' ') || '');
      personalizedMessage = personalizedMessage.replace(/\{\{fullname\}\}/gi, leadData.fullname || '');
      personalizedMessage = personalizedMessage.replace(/\{\{company\}\}/gi, leadData.company || leadData.organization || '');
      personalizedMessage = personalizedMessage.replace(/\{\{title\}\}/gi, leadData.title || '');
      
      logger.info('[LinkedInPolling] Personalized message ready', {
        campaignId,
        leadId: correctLeadId,
        leadName: leadData.fullname || leadData.name || leadName,
        messagePreview: personalizedMessage.substring(0, 50) + '...'
      });
      
      // Determine if this is a first message (newly accepted connection) or follow-up
      const recipientProviderId = context.recipientProviderId;
      const isFirstMessage = !!recipientProviderId;
      
      let result;
      
      if (isFirstMessage) {
        // This is a newly accepted connection - use POST /chats with text (create chat + send first message)
        logger.info('[LinkedInPolling] Sending FIRST message to newly accepted connection', {
          campaignId,
          leadId: correctLeadId,
          recipientProviderId,
          accountName: accountData.account_name,
          senderAccountId: actualSenderAccountId,  // ✅ Active account (original or alternate)
          usingAlternate: actualSenderAccountId !== senderAccountId,
          leadName: leadData.fullname || leadData.name || leadName
        });
        
        // ✅ SMART: Use actualSenderAccountId (active account for user_id)
        result = await unipileService.sendFirstLinkedInMessage(
          actualSenderAccountId,  // ✅ Active account (automatic failover if original inactive)
          recipientProviderId,
          personalizedMessage,
          { tenantId, campaignId, leadId: correctLeadId }
        );
        
        logger.info('[LinkedInPolling] sendFirstLinkedInMessage result:', {
          campaignId,
          leadId: correctLeadId,
          accountName: accountData.account_name,  // ✅ Use current name from database
          resultSuccess: result.success,
          resultError: result.error,
          resultChatId: result.chatId,
          resultMessageId: result.messageId
        });
      } else {
        // This is a follow-up message - use existing chat lookup logic
        logger.info('[LinkedInPolling] Sending follow-up message (existing chat)', {
          campaignId,
          leadId: correctLeadId,
          accountName: accountData.account_name,
          senderAccountId: actualSenderAccountId,  // ✅ Active account (original or alternate)
          usingAlternate: actualSenderAccountId !== senderAccountId,
          linkedInUrl
        });
        
        const employee = {
          fullname: leadData.fullname || leadData.name || leadName,
          linkedin_url: linkedInUrl,
          first_name: leadData.first_name,
          last_name: leadData.last_name,
          company: leadData.company_name || leadData.company,
          title: leadData.title,
          ...leadData
        };
        
        // ✅ SMART: Use actualSenderAccountId (active account for user_id)
        result = await unipileService.sendLinkedInMessage(
          employee,
          personalizedMessage,
          actualSenderAccountId,  // ✅ Active account (automatic failover if original inactive)
          { tenantId, campaignId, leadId: correctLeadId }
        );
      }
      
      // Always track the attempt, whether success or failure
      const finalLeadName = leadData.fullname || leadData.name || leadName;
      // recipientProviderId already declared above (line ~811)
      
      const trackingData = {
        leadId: correctLeadId,
        channel: 'linkedin',
        leadName: finalLeadName,
        messageContent: personalizedMessage,
        tenantId: tenantId,
        accountName: accountData.account_name,  // ✅ Current account name (may be alternate)
        providerAccountId: actualSenderAccountId,  // ✅ ACTUALLY USED account ID (original or alternate)
        userId: userId,  // ✅ User ID from social_linkedin_accounts
        leadLinkedIn: leadData.linkedin || linkedInUrl
      };
      
      if (result.success) {
        // Track successful message
        trackingData.status = 'success';
        trackingData.responseData = JSON.stringify({
          chatId: result.chatId || result.chat_id,
          timestamp: new Date().toISOString()
        });
        
        logger.info('[LinkedInPolling] ✅ Message sent immediately after connection acceptance', {
          campaignId,
          leadId: correctLeadId,
          leadName: leadData.fullname
        });
      } else {
        // Track failed message with error details
        trackingData.status = 'failed';
        trackingData.errorMessage = result.error || 'Unknown error';
        trackingData.responseData = JSON.stringify({
          error: result.error,
          statusCode: result.statusCode,
          details: result.details,
          timestamp: new Date().toISOString()
        });
        
        logger.warn('[LinkedInPolling] ⚠️ Immediate message sending failed', {
          campaignId,
          leadId: correctLeadId,
          error: result.error,
          statusCode: result.statusCode
        });
      }
      
      // Track the CONTACTED action (success or failed)
      await campaignStatsTracker.trackAction(campaignId, 'CONTACTED', trackingData);
      
      logger.info('[LinkedInPolling] CONTACTED action tracked', {
        campaignId,
        leadId: correctLeadId,
        status: trackingData.status
      });
      
      return result;
      
    } catch (error) {
      logger.error('[LinkedInPolling] Error in immediate message sending', {
        campaignId,
        leadId,
        errorMessage: error.message,
        errorStack: error.stack
      });
      return { success: false, error: error.message };
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
    
    // Remove trailing slash for consistent matching
    normalized = normalized.replace(/\/$/, '');
    
    return normalized.toLowerCase(); // Convert to lowercase for case-insensitive matching
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
}

module.exports = new LinkedInPollingService();
