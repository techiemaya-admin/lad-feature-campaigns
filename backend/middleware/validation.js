/**
 * Validation Middleware for Campaigns Feature
 */

/**
 * Validate campaign creation request
 */
function validateCampaignCreation(req, res, next) {
  const { name, type } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Campaign name is required and must be a string'
    });
  }

  if (name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Campaign name cannot be empty'
    });
  }

  if (name.length > 255) {
    return res.status(400).json({
      success: false,
      error: 'Campaign name too long (max 255 characters)'
    });
  }

  if (type && !['email', 'sms', 'voice', 'multi-channel'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid campaign type. Must be: email, sms, voice, or multi-channel'
    });
  }

  next();
}

/**
 * Validate campaign update request
 */
function validateCampaignUpdate(req, res, next) {
  const { name, status } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name must be a non-empty string'
      });
    }
    if (name.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name too long (max 255 characters)'
      });
    }
  }

  if (status && !['draft', 'active', 'paused', 'completed', 'archived'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid status. Must be: draft, active, paused, completed, or archived'
    });
  }

  next();
}

/**
 * Validate UUID parameter
 */
function validateUuidParam(paramName = 'id') {
  return (req, res, next) => {
    const uuid = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuid || !uuidRegex.test(uuid)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${paramName} format`
      });
    }

    next();
  };
}

/**
 * Validate pagination parameters
 */
function validatePagination(req, res, next) {
  const { limit, offset } = req.query;

  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        success: false,
        error: 'Offset must be a non-negative number'
      });
    }
  }

  next();
}

/**
 * Validate lead IDs array
 */
function validateLeadIds(req, res, next) {
  const { leadIds } = req.body;

  if (!leadIds || !Array.isArray(leadIds)) {
    return res.status(400).json({
      success: false,
      error: 'leadIds must be an array'
    });
  }

  if (leadIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'leadIds array cannot be empty'
    });
  }

  if (leadIds.length > 1000) {
    return res.status(400).json({
      success: false,
      error: 'Too many lead IDs (max 1000 per request)'
    });
  }

  // Validate each ID is a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = leadIds.filter(id => !uuidRegex.test(id));
  
  if (invalidIds.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid lead ID format',
      invalidIds: invalidIds.slice(0, 5) // Show first 5 invalid IDs
    });
  }

  next();
}

module.exports = {
  validateCampaignCreation,
  validateCampaignUpdate,
  validateUuidParam,
  validatePagination,
  validateLeadIds
};
