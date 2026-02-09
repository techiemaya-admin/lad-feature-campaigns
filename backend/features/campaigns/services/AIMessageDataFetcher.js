/**
 * AI Message Data Service
 * Business logic for fetching and processing AI message data for campaigns
 * LAD Architecture: Service layer - calls Repository, contains business logic
 */

const AIMessageRepository = require('../repositories/AIMessageRepository');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class AIMessageDataService {
  /**
   * Fetch message_data from ai_messages for a conversation
   * @param {string} conversationId - UUID of the conversation
   * @param {string} tenantId - Tenant UUID (from JWT)
   * @returns {Promise<Object|null>} The message_data JSONB object
   */
  static async fetchMessageDataByConversation(conversationId, tenantId) {
    // Validate tenant context
    if (!tenantId) {
      throw new Error('Tenant context required');
    }

    if (!conversationId) {
      throw new Error('Conversation ID required');
    }

    const schema = getSchema();
    
    try {
      const messageRow = await AIMessageRepository.findMessageDataByConversation(
        conversationId,
        tenantId,
        schema
      );

      if (!messageRow) {
        logger.warn('[AIMessageDataService] No message_data found for conversation', {
          conversationId,
          tenantId
        });
        return null;
      }

      // Validate tenant ownership
      if (messageRow.tenant_id !== tenantId) {
        logger.error('[AIMessageDataService] Tenant mismatch - security violation', {
          conversationId,
          requestedTenantId: tenantId,
          actualTenantId: messageRow.tenant_id
        });
        throw new Error('Unauthorized access to conversation');
      }

      const messageData = messageRow.message_data;
      
      logger.info('[AIMessageDataService] RAW message_data from database', {
        conversationId,
        messageId: messageRow.id,
        rawData: JSON.stringify(messageData, null, 2),
        hasCollectedAnswers: !!messageData.collectedAnswers,
        topLevelKeys: Object.keys(messageData)
      });
      
      // Normalize the message_data structure to handle nested collectedAnswers
      const normalizedData = this.normalizeMessageData(messageData);
      
      logger.info('[AIMessageDataService] NORMALIZED message_data', {
        conversationId,
        tenantId,
        messageId: messageRow.id,
        normalizedData: JSON.stringify(normalizedData, null, 2),
        hasTimestamp: !!normalizedData.timestamp,
        hasCampaignDays: !!normalizedData.campaign_days,
        hasWorkingDays: !!normalizedData.working_days,
        isNested: !!(messageData.collectedAnswers)
      });

      return normalizedData;
    } catch (error) {
      logger.error('[AIMessageDataService] Error fetching message_data', {
        error: error.message,
        conversationId,
        tenantId,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Normalize message_data structure
   * Handles both flat and nested (collectedAnswers) structures
   * @param {Object} messageData - Raw message_data from database
   * @returns {Object} Normalized message_data with top-level fields
   */
  static normalizeMessageData(messageData) {
    if (!messageData) {
      return null;
    }

    // If data is already at top level, return as-is
    if (messageData.campaign_days && messageData.working_days && messageData.timestamp) {
      return messageData;
    }

    // If data is nested in collectedAnswers, extract and flatten
    if (messageData.collectedAnswers) {
      const { collectedAnswers, timestamp, ...rest } = messageData;
      
      return {
        timestamp: timestamp || collectedAnswers.timestamp || new Date().toISOString(),
        campaign_days: collectedAnswers.campaign_days,
        working_days: collectedAnswers.working_days,
        leads_per_day: collectedAnswers.leads_per_day,
        campaign_name: collectedAnswers.campaign_name,
        campaign_goal: collectedAnswers.campaign_goal,
        ...rest,  // Keep other top-level fields
        originalCollectedAnswers: collectedAnswers  // Preserve original for reference
      };
    }

    // Return as-is if structure doesn't match expected patterns
    return messageData;
  }

  /**
   * Fetch all message_data entries for a conversation (for debugging)
   * @param {string} conversationId - UUID of the conversation
   * @param {string} tenantId - Tenant UUID
   * @returns {Promise<Array>} Array of message_data objects
   */
  static async fetchAllMessageDataByConversation(conversationId, tenantId) {
    // Validate tenant context
    if (!tenantId) {
      throw new Error('Tenant context required');
    }

    if (!conversationId) {
      throw new Error('Conversation ID required');
    }

    const schema = getSchema();
    
    try {
      const messageRows = await AIMessageRepository.findAllMessageDataByConversation(
        conversationId,
        tenantId,
        schema
      );

      return messageRows.map(row => ({
        id: row.id,
        role: row.role,
        messageData: row.message_data,
        createdAt: row.created_at,
        tenantId: row.tenant_id
      }));
    } catch (error) {
      logger.error('[AIMessageDataService] Error fetching all message_data', {
        error: error.message,
        conversationId,
        tenantId,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = AIMessageDataService;
