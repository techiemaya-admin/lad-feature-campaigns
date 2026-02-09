/**
 * AI Message Repository
 * Data access layer for ai_messages table
 * LAD Architecture: Repository pattern - SQL queries only
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');
const logger = require('../../../core/utils/logger');

class AIMessageRepository {
  /**
   * Fetch message_data from ai_messages for a conversation
   * Returns the most recent assistant message with completed campaign data
   * @param {string} conversationId - UUID of the conversation
   * @param {string} tenantId - Tenant UUID (for security validation)
   * @param {string} schema - Database schema
   * @returns {Promise<Object|null>} The message row with message_data
   */
  static async findMessageDataByConversation(conversationId, tenantId, schema) {
    try {
      const query = `
        SELECT 
          m.id,
          m.message_data,
          m.created_at,
          c.tenant_id
        FROM ${schema}.ai_messages m
        INNER JOIN ${schema}.ai_conversations c ON m.conversation_id = c.id
        WHERE 
          m.conversation_id = $1 
          AND c.tenant_id = $2
          AND m.role = 'user'
          AND m.message_data IS NOT NULL
          AND m.message_data::text != '{}'
          AND m.message_data->'collectedAnswers'->'confirmation' IS NOT NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      `;

      const result = await pool.query(query, [conversationId, tenantId]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('[AIMessageRepository] Error fetching message_data', {
        error: error.message,
        conversationId,
        tenantId,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Fetch all message_data entries for a conversation (for debugging)
   * @param {string} conversationId - UUID of the conversation
   * @param {string} tenantId - Tenant UUID
   * @param {string} schema - Database schema
   * @returns {Promise<Array>} Array of message rows
   */
  static async findAllMessageDataByConversation(conversationId, tenantId, schema) {
    try {
      const query = `
        SELECT 
          m.id,
          m.role,
          m.message_data,
          m.created_at,
          c.organization_id as tenant_id
        FROM ${schema}.ai_messages m
        INNER JOIN ${schema}.ai_conversations c ON m.conversation_id = c.id
        WHERE 
          m.conversation_id = $1 
          AND c.organization_id = $2
          AND m.message_data IS NOT NULL
          AND m.message_data::text != '{}'
        ORDER BY m.created_at DESC
      `;

      const result = await pool.query(query, [conversationId, tenantId]);
      return result.rows;
    } catch (error) {
      logger.error('[AIMessageRepository] Error fetching all message_data', {
        error: error.message,
        conversationId,
        tenantId,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = AIMessageRepository;
