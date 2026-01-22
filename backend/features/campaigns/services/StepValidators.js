/**
 * Step Validators
 * Handles validation of campaign step configurations
 */
/**
 * Get required fields for each step type (matches frontend validation)
 */
function getRequiredFieldsForStepType(stepType) {
  const requiredFields = {
    linkedin_connect: [], // Message is optional due to LinkedIn's 4-5 connection messages/month limit
    linkedin_message: ['message'],
    email_send: ['subject', 'body'],
    email_followup: ['subject', 'body'],
    whatsapp_send: ['whatsappMessage'],
    voice_agent_call: ['voiceAgentId', 'voiceContext'], // voiceContext maps to added_context (required by API)
    instagram_dm: ['instagramUsername', 'instagramDmMessage'],
    delay: ['delayDays', 'delayHours'], // At least one time unit must be > 0
    condition: [], // Handled specially - accepts 'condition' or 'conditionType'
    linkedin_scrape_profile: ['linkedinScrapeFields'],
    linkedin_company_search: ['linkedinCompanyName'],
    linkedin_employee_list: ['linkedinCompanyUrl'],
    linkedin_autopost: ['linkedinPostContent'],
    linkedin_comment_reply: ['linkedinCommentText'],
    instagram_follow: ['instagramUsername'],
    instagram_like: ['instagramPostUrl'],
    instagram_autopost: ['instagramPostCaption', 'instagramPostImageUrl'],
    instagram_comment_reply: ['instagramCommentText'],
    instagram_story_view: ['instagramUsername'],
    lead_generation: [], // Handled specially - uses leadGenerationFilters
    // No required fields for these
    linkedin_visit: [],
    linkedin_follow: [],
    start: [],
    end: [],
  };
  return requiredFields[stepType] || [];
}
/**
 * Check if a field value is valid (not empty, null, or undefined)
 */
function isFieldValid(fieldValue) {
  if (fieldValue === undefined || fieldValue === null) return false;
  if (typeof fieldValue === 'string' && fieldValue.trim() === '') return false;
  if (Array.isArray(fieldValue) && fieldValue.length === 0) return false;
  if (typeof fieldValue === 'number' && isNaN(fieldValue)) return false;
  return true;
}
/**
 * Validate delay step - at least one time unit must be > 0
 */
function isDelayValid(stepConfig) {
  const days = parseInt(stepConfig.delayDays || stepConfig.delay_days || 0);
  const hours = parseInt(stepConfig.delayHours || stepConfig.delay_hours || 0);
  const minutes = parseInt(stepConfig.delayMinutes || stepConfig.delay_minutes || 0);
  return days > 0 || hours > 0 || minutes > 0;
}
/**
 * Validate step configuration - check if all required fields are filled
 */
function validateStepConfig(stepType, stepConfig) {
  let requiredFields = getRequiredFieldsForStepType(stepType);
  const missingFields = [];
  const invalidFields = [];
  // Special handling for condition - accepts either 'condition' or 'conditionType'
  if (stepType === 'condition') {
    const hasCondition = isFieldValid(stepConfig.condition) || isFieldValid(stepConfig.conditionType);
    if (!hasCondition) {
      return {
        valid: false,
        error: 'Condition step requires a condition to be specified (condition or conditionType field)',
        missingFields: ['condition']
      };
    }
    // Condition validation passed
    return { valid: true };
  }
  // Special validation for delay step
  if (stepType === 'delay') {
    if (!isDelayValid(stepConfig)) {
      return {
        valid: false,
        error: 'Delay step requires at least one time unit (days, hours, or minutes) to be greater than 0',
        missingFields: ['delayDays', 'delayHours']
      };
    }
    // Delay validation passed, skip field checks
    return { valid: true };
  }
  // Special handling for lead_generation - uses leadGenerationFilters and leads_per_day from campaign config
  if (stepType === 'lead_generation') {
    // Parse filters if it's a string
    let filters = stepConfig.leadGenerationFilters;
    if (filters && typeof filters === 'string') {
      try {
        filters = JSON.parse(filters);
      } catch (e) {
        // Invalid JSON, treat as empty
        filters = {};
      }
    }
    // Check if filters object has at least one valid field (roles, industries, or location)
    let hasValidFilters = false;
    const missingFilterFields = [];
    if (filters && typeof filters === 'object') {
      // Check for roles (array of strings)
      if (filters.roles && Array.isArray(filters.roles) && filters.roles.length > 0) {
        const validRoles = filters.roles.filter(r => r && typeof r === 'string' && r.trim().length > 0);
        if (validRoles.length > 0) {
          hasValidFilters = true;
        } else {
          missingFilterFields.push('roles');
        }
      } else {
        missingFilterFields.push('roles');
      }
      // Check for industries (array of strings)
      if (filters.industries && Array.isArray(filters.industries) && filters.industries.length > 0) {
        const validIndustries = filters.industries.filter(i => i && typeof i === 'string' && i.trim().length >= 2);
        if (validIndustries.length > 0) {
          hasValidFilters = true;
        } else {
          if (!missingFilterFields.includes('industries')) missingFilterFields.push('industries');
        }
      } else {
        if (!missingFilterFields.includes('industries')) missingFilterFields.push('industries');
      }
      // Check for location (string or array)
      if (filters.location) {
        if (typeof filters.location === 'string' && filters.location.trim().length > 0) {
          hasValidFilters = true;
        } else if (Array.isArray(filters.location) && filters.location.length > 0) {
          const validLocations = filters.location.filter(l => l && typeof l === 'string' && l.trim().length > 0);
          if (validLocations.length > 0) {
            hasValidFilters = true;
          } else {
            missingFilterFields.push('location');
          }
        } else {
          missingFilterFields.push('location');
        }
      } else {
        missingFilterFields.push('location');
      }
    }
    // Also check for leadGenerationLimit or leads_per_day as fallback
    const hasLimit = isFieldValid(stepConfig.leadGenerationLimit) || isFieldValid(stepConfig.leads_per_day);
    // Lead generation requires at least one of: valid filters OR limit
    if (!hasValidFilters && !hasLimit) {
      const missingFields = ['leadGenerationFilters'];
      if (!hasLimit) {
        missingFields.push('leadGenerationLimit');
      }
      return {
        valid: false,
        error: 'Lead generation step requires at least one filter criteria (roles, industries, or location) in leadGenerationFilters, or a leadGenerationLimit to be configured',
        missingFields: missingFields
      };
    }
    // Lead generation validation passed, skip other field checks
    return { valid: true };
  }
  // Special handling for voice_agent_call - accept either voiceContext or added_context
  if (stepType === 'voice_agent_call') {
    const hasVoiceContext = isFieldValid(stepConfig.voiceContext);
    const hasAddedContext = isFieldValid(stepConfig.added_context);
    if (!hasVoiceContext && !hasAddedContext) {
      missingFields.push('voiceContext');
    }
    // Remove voiceContext from requiredFields check since we handled it above
    requiredFields = requiredFields.filter(f => f !== 'voiceContext');
  }
  // Check all required fields
  for (const field of requiredFields) {
    const fieldValue = stepConfig[field];
    if (!isFieldValid(fieldValue)) {
      missingFields.push(field);
      invalidFields.push(field);
    }
  }
  if (missingFields.length > 0) {
    return {
      valid: false,
      error: `Missing required fields: ${missingFields.join(', ')}. Please configure all required fields in step settings.`,
      missingFields: missingFields
    };
  }
  return { valid: true };
}
/**
 * Get channel for step type
 */
function getChannelForStepType(stepType) {
  if (stepType.startsWith('linkedin_')) return 'linkedin';
  if (stepType.startsWith('email_')) return 'email';
  if (stepType.startsWith('whatsapp_')) return 'whatsapp';
  if (stepType.startsWith('instagram_')) return 'instagram';
  if (stepType === 'voice_agent_call') return 'voice';
  if (stepType === 'lead_generation') return 'campaign';
  return 'other';
}
module.exports = {
  getRequiredFieldsForStepType,
  isFieldValid,
  isDelayValid,
  validateStepConfig,
  getChannelForStepType
};