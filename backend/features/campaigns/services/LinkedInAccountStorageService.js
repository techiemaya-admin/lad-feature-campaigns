/**
 * LinkedIn Account Storage Service
 * Handles business logic for LinkedIn account storage
 * LAD Architecture: Service Layer (NO SQL - calls Repository)
 */

const LinkedInAccountRepository = require('../repositories/LinkedInAccountRepository');
const { pool } = require('../../../shared/database/connection');
const logger = require('../../../core/utils/logger');

// Initialize repository
const linkedInAccountRepository = new LinkedInAccountRepository(pool);

class LinkedInAccountStorageService {
  /**
   * Save LinkedIn account credentials
   * LAD Architecture: Service contains business logic, calls repository for data
   * @param {string} userId - User ID (UUID)
   * @param {string} tenantId - Tenant ID (UUID)
   * @param {Object} credentials - Account credentials with unipile_account_id, profile_name, etc.
   */
  async saveLinkedInAccount(userId, tenantId, credentials) {
    const unipileAccountId = credentials.unipile_account_id;
    
    logger.info('[LinkedInAccountStorage] Saving account', { 
      userId: userId?.substring(0, 8),
      tenantId: tenantId?.substring(0, 8),
      unipileAccountId: unipileAccountId?.substring(0, 8),
      hasProfileName: !!credentials.profile_name,
      hasEmail: !!credentials.email
    });
    
    // Validate required fields
    if (!unipileAccountId) {
      logger.error('[LinkedInAccountStorage] Missing unipile_account_id');
      throw new Error('unipile_account_id is required');
    }
    
    try {
      // Check if account already exists (business logic)
      const existing = await linkedInAccountRepository.checkExistingAccount(
        userId, 
        tenantId, 
        unipileAccountId
      );
      
      // Build metadata (business logic)
      const metadata = {
        profile_name: credentials.profile_name || null,
        profile_url: credentials.profile_url || null,
        email: credentials.email || null,
        connected_at: credentials.connected_at || new Date().toISOString(),
        ...credentials
      };
      
      // Build account name (business logic)
      const accountName = credentials.profile_name || 
                         credentials.email?.split('@')[0] || 
                         'LinkedIn Account';
      
      const accountData = {
        userId,
        tenantId,
        unipileAccountId,
        accountName,
        metadata
      };
      
      let result;
      
      if (existing) {
        // Update existing account
        logger.info('[LinkedInAccountStorage] Updating existing account', { 
          existingId: existing.id?.substring(0, 8)
        });
        
        result = await linkedInAccountRepository.updateAccount(accountData);
      } else {
        // Insert new account
        logger.info('[LinkedInAccountStorage] Creating new account');
        
        result = await linkedInAccountRepository.insertAccount(accountData);
      }
      
      logger.info('[LinkedInAccountStorage] Account saved successfully', { 
        accountId: result?.id?.substring(0, 8),
        accountName: result?.account_name,
        status: result?.status,
        isUpdate: !!existing
      });
      
      return result;
    } catch (error) {
      logger.error('[LinkedInAccountStorage] Failed to save account', { 
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }
}

module.exports = new LinkedInAccountStorageService();
