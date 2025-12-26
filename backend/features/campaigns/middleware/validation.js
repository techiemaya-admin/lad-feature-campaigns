/**
 * Campaign Validation Middleware
 * Provides request validation for campaign endpoints
 */

/**
 * Validate UUID format
 */
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Validate UUID parameter
 */
const validateUuidParam = (paramName) => {
  return (req, res, next) => {
    const value = req.params[paramName];
    
    if (!value || !isValidUUID(value)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${paramName}: must be a valid UUID`
      });
    }
    
    next();
  };
};

/**
 * Validate pagination parameters
 */
const validatePagination = (req, res, next) => {
  const { page, limit } = req.query;
  
  if (page && (isNaN(page) || parseInt(page) < 1)) {
    return res.status(400).json({
      success: false,
      error: 'page must be a positive integer'
    });
  }
  
  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    return res.status(400).json({
      success: false,
      error: 'limit must be between 1 and 100'
    });
  }
  
  next();
};

/**
 * Validate campaign creation
 */
const validateCampaignCreation = (req, res, next) => {
  const { name, campaign_type, status, steps } = req.body;
  
  // Name is required
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Campaign name is required'
    });
  }
  
  if (name.length > 255) {
    return res.status(400).json({
      success: false,
      error: 'Campaign name must be less than 255 characters'
    });
  }
  
  // Validate campaign_type if provided
  const validTypes = ['linkedin_outreach', 'email_outreach', 'multi_channel'];
  if (campaign_type && !validTypes.includes(campaign_type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid campaign_type. Must be one of: ${validTypes.join(', ')}`
    });
  }
  
  // Validate status if provided
  const validStatuses = ['draft', 'active', 'paused', 'completed', 'stopped'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
    });
  }
  
  // Validate steps if provided
  if (steps && !Array.isArray(steps)) {
    return res.status(400).json({
      success: false,
      error: 'steps must be an array'
    });
  }
  
  next();
};

/**
 * Validate campaign update
 */
const validateCampaignUpdate = (req, res, next) => {
  const { name, campaign_type, status, steps } = req.body;
  
  // Name validation if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name cannot be empty'
      });
    }
    
    if (name.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name must be less than 255 characters'
      });
    }
  }
  
  // Validate campaign_type if provided
  const validTypes = ['linkedin_outreach', 'email_outreach', 'multi_channel'];
  if (campaign_type && !validTypes.includes(campaign_type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid campaign_type. Must be one of: ${validTypes.join(', ')}`
    });
  }
  
  // Validate status if provided
  const validStatuses = ['draft', 'active', 'paused', 'completed', 'stopped'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
    });
  }
  
  // Validate steps if provided
  if (steps && !Array.isArray(steps)) {
    return res.status(400).json({
      success: false,
      error: 'steps must be an array'
    });
  }
  
  next();
};

/**
 * Validate lead IDs or leads array
 * Supports both formats:
 * - { leadIds: [uuid1, uuid2] } - for adding existing leads by ID
 * - { leads: [{ firstName, lastName, ... }] } - for creating new leads
 */
const validateLeadIds = (req, res, next) => {
  const { leadIds, leads } = req.body;
  
  // Accept either leadIds or leads format
  if (leadIds) {
    // Validate leadIds format (array of UUIDs)
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'leadIds must be a non-empty array'
    });
  }
  
  // Validate each leadId is a UUID
  for (const leadId of leadIds) {
    if (!isValidUUID(leadId)) {
      return res.status(400).json({
        success: false,
        error: `Invalid leadId: ${leadId}. Each leadId must be a valid UUID`
      });
    }
    }
  } else if (leads) {
    // Validate leads format (array of lead objects)
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'leads must be a non-empty array'
      });
    }
    
    // Basic validation for lead objects
    for (const lead of leads) {
      if (!lead || typeof lead !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Each lead must be an object'
        });
      }
      
      // At least firstName and lastName or linkedinUrl should be present
      if (!lead.firstName && !lead.linkedinUrl) {
        return res.status(400).json({
          success: false,
          error: 'Each lead must have at least firstName or linkedinUrl'
        });
      }
    }
  } else {
    // Neither format provided
    return res.status(400).json({
      success: false,
      error: 'Either leadIds or leads array is required'
    });
  }
  
  next();
};

module.exports = {
  validateUuidParam,
  validatePagination,
  validateCampaignCreation,
  validateCampaignUpdate,
  validateLeadIds
};
