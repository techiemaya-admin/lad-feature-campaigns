/**
 * Condition Evaluator - evaluates workflow conditions
 */
class ConditionEvaluator {
  /**
   * Evaluate a condition step
   */
  async evaluateCondition(step, lead, executionResult) {
    try {
      const stepConfig = typeof step.data === 'string' 
        ? JSON.parse(step.data) 
        : (step.data || {});

      const conditionType = stepConfig.conditionType;

      switch (conditionType) {
        case 'response_received':
          return this.checkResponseReceived(lead, executionResult);

        case 'profile_matches':
          return this.checkProfileMatches(lead, stepConfig);

        case 'engagement_level':
          return this.checkEngagementLevel(lead, stepConfig);

        case 'time_elapsed':
          return this.checkTimeElapsed(lead, stepConfig);

        case 'custom_field':
          return this.checkCustomField(lead, stepConfig);

        default:
          console.warn(`[ConditionEvaluator] Unknown condition type: ${conditionType}`);
          return false;
      }
    } catch (error) {
      console.error('[ConditionEvaluator] Error evaluating condition:', error);
      return false;
    }
  }

  /**
   * Check if lead has responded
   */
  checkResponseReceived(lead, executionResult) {
    // Check if there's a response in the execution result
    return executionResult?.responseReceived || false;
  }

  /**
   * Check if lead profile matches criteria
   */
  checkProfileMatches(lead, stepConfig) {
    const criteria = stepConfig.profileCriteria || {};
    const leadData = lead.lead_data || {};

    // Check title match
    if (criteria.title) {
      const title = leadData.title || leadData.headline || '';
      if (!title.toLowerCase().includes(criteria.title.toLowerCase())) {
        return false;
      }
    }

    // Check seniority match
    if (criteria.seniority) {
      const seniority = leadData.seniority_level || '';
      if (seniority !== criteria.seniority) {
        return false;
      }
    }

    // Check industry match
    if (criteria.industry) {
      const industry = leadData.industry || '';
      if (!industry.toLowerCase().includes(criteria.industry.toLowerCase())) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check engagement level
   */
  checkEngagementLevel(lead, stepConfig) {
    const minEngagement = stepConfig.minEngagementScore || 0;
    const leadEngagement = lead.engagement_score || 0;

    return leadEngagement >= minEngagement;
  }

  /**
   * Check time elapsed since last activity
   */
  checkTimeElapsed(lead, stepConfig) {
    const requiredDays = stepConfig.daysElapsed || 0;
    const lastActivityDate = lead.last_activity_at || lead.created_at;

    if (!lastActivityDate) return false;

    const daysSinceActivity = (Date.now() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActivity >= requiredDays;
  }

  /**
   * Check custom field value
   */
  checkCustomField(lead, stepConfig) {
    const fieldName = stepConfig.fieldName;
    const expectedValue = stepConfig.expectedValue;
    const operator = stepConfig.operator || 'equals';

    const customFields = lead.custom_fields || {};
    const actualValue = customFields[fieldName];

    switch (operator) {
      case 'equals':
        return actualValue === expectedValue;
      case 'not_equals':
        return actualValue !== expectedValue;
      case 'contains':
        return String(actualValue).includes(String(expectedValue));
      case 'greater_than':
        return Number(actualValue) > Number(expectedValue);
      case 'less_than':
        return Number(actualValue) < Number(expectedValue);
      default:
        return false;
    }
  }
}

module.exports = new ConditionEvaluator();
