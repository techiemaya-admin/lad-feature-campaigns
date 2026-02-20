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
    // Parse filters - accept both leadGenerationFilters and filters field names
    let filters = stepConfig.leadGenerationFilters || stepConfig.filters;
    if (filters && typeof filters === 'string') {
      try {
        filters = JSON.parse(filters);
      } catch (e) {
        // Invalid JSON, treat as empty
        filters = {};
      }
    }
    
    // Check if filters object has at least one valid field
    // Support both old format (roles, industries, location) and Apollo API format
    let hasValidFilters = false;
    const missingFilterFields = [];
    
    // Also check for Apollo API format filters directly in stepConfig
    const hasApolloFilters = 
      (stepConfig.q_organization_keyword_tags && Array.isArray(stepConfig.q_organization_keyword_tags) && stepConfig.q_organization_keyword_tags.length > 0) ||
      (stepConfig.organization_num_employees_ranges && Array.isArray(stepConfig.organization_num_employees_ranges) && stepConfig.organization_num_employees_ranges.length > 0) ||
      (stepConfig.person_titles && Array.isArray(stepConfig.person_titles) && stepConfig.person_titles.length > 0) ||
      (stepConfig.organization_locations && Array.isArray(stepConfig.organization_locations) && stepConfig.organization_locations.length > 0) ||
      (stepConfig.organization_industries && Array.isArray(stepConfig.organization_industries) && stepConfig.organization_industries.length > 0);
    
    if (hasApolloFilters) {
      hasValidFilters = true;
    } else if (filters && typeof filters === 'object') {
      // Check for old format filters in leadGenerationFilters
      // Check for roles (person_titles in new format)
      if (filters.roles && Array.isArray(filters.roles) && filters.roles.length > 0) {
        const validRoles = filters.roles.filter(r => r && typeof r === 'string' && r.trim().length > 0);
        if (validRoles.length > 0) {
          hasValidFilters = true;
        }
      }
      
      // Check for person_titles (Apollo format within filters)
      if (!hasValidFilters && filters.person_titles && Array.isArray(filters.person_titles) && filters.person_titles.length > 0) {
        hasValidFilters = true;
      }
      
      // Check for industries (organization_industries in new format)
      if (!hasValidFilters && filters.industries && Array.isArray(filters.industries) && filters.industries.length > 0) {
        const validIndustries = filters.industries.filter(i => i && typeof i === 'string' && i.trim().length >= 2);
        if (validIndustries.length > 0) {
          hasValidFilters = true;
        }
      }
      
      // Check for organization_industries (Apollo format within filters)
      if (!hasValidFilters && filters.organization_industries && Array.isArray(filters.organization_industries) && filters.organization_industries.length > 0) {
        hasValidFilters = true;
      }
      
      // Check for location (organization_locations in new format)
      if (!hasValidFilters && filters.location) {
        if (typeof filters.location === 'string' && filters.location.trim().length > 0) {
          hasValidFilters = true;
        } else if (Array.isArray(filters.location) && filters.location.length > 0) {
          const validLocations = filters.location.filter(l => l && typeof l === 'string' && l.trim().length > 0);
          if (validLocations.length > 0) {
            hasValidFilters = true;
          }
        }
      }
      
      // Check for organization_locations (Apollo format within filters)
      if (!hasValidFilters && filters.organization_locations && Array.isArray(filters.organization_locations) && filters.organization_locations.length > 0) {
        hasValidFilters = true;
      }
    }
    // Also check for leadGenerationLimit or leads_per_day as fallback
    const hasLimit = isFieldValid(stepConfig.leadGenerationLimit) || isFieldValid(stepConfig.leads_per_day);
    // Lead generation requires at least one of: valid filters OR limit
    if (!hasValidFilters && !hasLimit) {
      return {
        valid: false,
        error: 'Lead generation filter not configured. Please set at least one of: roles, location, or industries',
        missingFields: ['leadGenerationFilters']
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
