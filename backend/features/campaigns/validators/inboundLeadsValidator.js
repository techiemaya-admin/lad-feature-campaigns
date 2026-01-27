const logger = require('../../../core/utils/logger');

/**
 * Validator for inbound leads requests
 */
class InboundLeadsValidator {
  /**
   * Validate save leads request
   */
  static validateSaveLeadsRequest(req, res, next) {
    const { leads, skipDuplicates } = req.body;
    
    // Validate leads array exists
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: leads must be an array'
      });
    }
    
    // Validate leads array is not empty
    if (leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No leads provided'
      });
    }
    
    // Validate skipDuplicates is boolean if provided
    if (skipDuplicates !== undefined && typeof skipDuplicates !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: skipDuplicates must be a boolean'
      });
    }
    
    // Validate each lead has at least one identifying field
    const invalidLeads = [];
    leads.forEach((lead, index) => {
      const validationResult = InboundLeadsValidator.validateLeadData(lead);
      if (!validationResult.valid) {
        invalidLeads.push({
          index,
          lead: lead.companyName || lead.email || `Lead ${index + 1}`,
          errors: validationResult.errors
        });
      }
    });
    
    if (invalidLeads.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Some leads have validation errors',
        details: invalidLeads
      });
    }
    
    next();
  }
  
  /**
   * Validate individual lead data
   * @param {Object} leadData - Lead data to validate
   * @returns {Object} { valid: boolean, errors: Array }
   */
  static validateLeadData(leadData) {
    const errors = [];
    
    // At least one identifying field must be present
    const hasIdentifier = leadData.email || 
                          leadData.phone || 
                          leadData.whatsapp || 
                          leadData.linkedinProfile;
    
    if (!hasIdentifier) {
      errors.push('Lead must have at least one of: email, phone, whatsapp, or linkedinProfile');
    }
    
    // Validate email format if provided
    if (leadData.email && !InboundLeadsValidator.isValidEmail(leadData.email)) {
      errors.push('Invalid email format');
    }
    
    // Validate phone format if provided (basic check)
    if (leadData.phone && !InboundLeadsValidator.isValidPhone(leadData.phone)) {
      errors.push('Invalid phone format');
    }
    
    // Validate LinkedIn URL format if provided
    if (leadData.linkedinProfile && !InboundLeadsValidator.isValidLinkedInUrl(leadData.linkedinProfile)) {
      errors.push('Invalid LinkedIn profile URL format');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Validate email format
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Validate phone format (basic validation)
   */
  static isValidPhone(phone) {
    // Remove common formatting characters
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    // Check if it contains only digits and is reasonable length
    return /^\d{7,15}$/.test(cleaned);
  }
  
  /**
   * Validate LinkedIn URL format
   */
  static isValidLinkedInUrl(url) {
    const linkedInRegex = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|company)\/[\w\-]+\/?$/i;
    return linkedInRegex.test(url);
  }
  
  /**
   * Validate tenant ID
   */
  static validateTenantId(tenantId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(tenantId);
  }
}

module.exports = InboundLeadsValidator;
