/**
 * Apollo Webhook Service
 * Business logic for processing Apollo webhook callbacks
 * LAD Architecture Compliant
 */

const logger = require('../../../core/utils/logger');
const ApolloEmployeesCacheRepository = require('../repositories/ApolloEmployeesCacheRepository');

class ApolloWebhookService {
  /**
   * Process phone reveal webhook from Apollo
   * @param {Object} webhookData - Webhook payload from Apollo
   * @returns {Promise<Object>} - Result of processing
   */
  static async processPhoneReveal(webhookData) {
    try {
      logger.info('[Apollo Webhook Service] Processing phone reveal', {
        hasData: !!webhookData,
        hasPerson: !!webhookData?.person,
        personId: webhookData?.person?.id
      });

      // Validate webhook data
      if (!webhookData || !webhookData.person) {
        throw new Error('Invalid webhook data - missing person');
      }

      const person = webhookData.person;
      const apolloPersonId = person.id;
      
      if (!apolloPersonId) {
        throw new Error('Missing person ID in webhook data');
      }

      // Extract phone number from various possible fields
      const phoneNumber = person.sanitized_phone || 
                         person.phone_numbers?.[0] || 
                         person.phone || 
                         null;

      if (!phoneNumber) {
        logger.warn('[Apollo Webhook Service] No phone number in webhook data', {
          apolloPersonId
        });
        return {
          success: true,
          message: 'Webhook received but no phone number available',
          apolloPersonId
        };
      }

      // Find existing employee record to get tenant_id
      const existingEmployee = await ApolloEmployeesCacheRepository.findByPersonId(
        apolloPersonId,
        null, // Search across all tenants
        'lad_dev'
      );

      if (!existingEmployee) {
        logger.warn('[Apollo Webhook Service] Employee not found in cache', {
          apolloPersonId
        });
        throw new Error(`Employee with apollo_person_id ${apolloPersonId} not found`);
      }

      const tenantId = existingEmployee.tenant_id;
      const schema = 'lad_dev';

      // Update phone in employees_cache
      await ApolloEmployeesCacheRepository.updatePhone(
        apolloPersonId,
        phoneNumber,
        tenantId,
        schema
      );

      logger.info('[Apollo Webhook Service] Phone number saved successfully', {
        apolloPersonId,
        tenantId: tenantId.substring(0, 8) + '...',
        phoneLength: phoneNumber.length
      });

      return {
        success: true,
        message: 'Phone number saved successfully',
        apolloPersonId,
        phoneNumber: phoneNumber.substring(0, 4) + '***' // Masked for logging
      };

    } catch (error) {
      logger.error('[Apollo Webhook Service] Error processing phone reveal', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Validate webhook signature (if Apollo provides one)
   * @param {Object} req - Express request object
   * @returns {boolean} - Whether signature is valid
   */
  static validateWebhookSignature(req) {
    // Apollo.io doesn't currently provide webhook signatures
    // If they add it in the future, implement verification here
    return true;
  }

  /**
   * Extract tenant context from webhook data or headers
   * @param {Object} webhookData - Webhook payload
   * @param {Object} headers - Request headers
   * @returns {string|null} - Tenant ID if found
   */
  static extractTenantId(webhookData, headers) {
    return headers['x-tenant-id'] || 
           webhookData.tenant_id ||
           webhookData.person?.tenant_id ||
           null;
  }
}

module.exports = ApolloWebhookService;
