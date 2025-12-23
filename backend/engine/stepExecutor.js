const { pool } = require('../../../shared/database/connection');
const linkedinDispatcher = require('./channelDispatchers/linkedin');
const voiceDispatcher = require('./channelDispatchers/voice');
const emailDispatcher = require('./channelDispatchers/email');

/**
 * Step Executor - executes individual workflow steps
 */
class StepExecutor {
  constructor() {
    this.dispatchers = {
      linkedin_connect: linkedinDispatcher,
      linkedin_message: linkedinDispatcher,
      linkedin_visit: linkedinDispatcher,
      linkedin_follow: linkedinDispatcher,
      voice_agent_call: voiceDispatcher,
      email_send: emailDispatcher,
      email_followup: emailDispatcher,
    };
  }

  /**
   * Execute a step for a specific lead
   */
  async executeStepForLead(campaignId, lead, step, userId, orgId) {
    try {
      console.log(`[StepExecutor] Executing ${step.type} for lead ${lead.id}`);

      // Parse step config
      const stepConfig = typeof step.data === 'string' 
        ? JSON.parse(step.data) 
        : (step.data || {});

      // Validate step configuration
      const validation = this.validateStepConfig(step.type, stepConfig);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Create activity record
      const activityId = await this.createActivity(campaignId, lead.id, step.id, step.type);

      let result = { success: false };

      // Execute based on step type
      switch (step.type) {
        case 'start':
          result = { success: true };
          break;

        case 'end':
          result = { success: true };
          await this.markLeadCompleted(lead.id);
          break;

        case 'delay':
          result = await this.executeDelay(lead, stepConfig, activityId);
          break;

        case 'condition':
          result = { success: true }; // Conditions evaluated in workflow engine
          break;

        case 'lead_generation':
          result = await this.executeLeadGeneration(campaignId, step, stepConfig, userId, orgId);
          break;

        default:
          // Channel-specific actions (LinkedIn, Voice, Email, etc.)
          result = await this.executeChannelAction(step.type, lead, stepConfig, userId, orgId);
          break;
      }

      // Update activity status
      await this.updateActivityStatus(activityId, result.success ? 'completed' : 'error', result.error);

      return result;
    } catch (error) {
      console.error(`[StepExecutor] Error executing step:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute channel-specific action using appropriate dispatcher
   */
  async executeChannelAction(stepType, lead, stepConfig, userId, orgId) {
    const dispatcher = this.dispatchers[stepType];

    if (!dispatcher) {
      console.warn(`[StepExecutor] No dispatcher found for step type: ${stepType}`);
      return { success: false, error: `Unsupported step type: ${stepType}` };
    }

    return await dispatcher.execute(stepType, lead, stepConfig, userId, orgId);
  }

  /**
   * Execute delay step
   */
  async executeDelay(lead, stepConfig, activityId) {
    const days = parseInt(stepConfig.delayDays || stepConfig.delay_days || 0);
    const hours = parseInt(stepConfig.delayHours || stepConfig.delay_hours || 0);
    const minutes = parseInt(stepConfig.delayMinutes || stepConfig.delay_minutes || 0);

    const delayMs = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    const scheduledAt = new Date(Date.now() + delayMs);

    // Update activity with scheduled time
    await pool.query(
      `UPDATE campaign_lead_activities 
       SET scheduled_at = $1, status = 'pending'
       WHERE id = $2`,
      [scheduledAt, activityId]
    );

    console.log(`[StepExecutor] Delay scheduled until ${scheduledAt.toISOString()}`);

    return {
      success: true,
      delayPending: true,
      delayUntil: scheduledAt.toISOString()
    };
  }

  /**
   * Execute lead generation step
   */
  async executeLeadGeneration(campaignId, step, stepConfig, userId, orgId) {
    // This would integrate with Apollo or other lead gen services
    // For now, return success
    console.log('[StepExecutor] Lead generation executed');
    return { success: true, leadsGenerated: 0 };
  }

  /**
   * Mark lead as completed
   */
  async markLeadCompleted(leadId) {
    await pool.query(
      `UPDATE campaign_leads 
       SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [leadId]
    );
  }

  /**
   * Create activity record
   */
  async createActivity(campaignId, leadId, stepId, stepType) {
    const result = await pool.query(
      `INSERT INTO campaign_lead_activities 
       (campaign_id, lead_id, step_id, step_type, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP)
       RETURNING id`,
      [campaignId, leadId, stepId, stepType]
    );

    return result.rows[0].id;
  }

  /**
   * Update activity status
   */
  async updateActivityStatus(activityId, status, errorMessage = null) {
    await pool.query(
      `UPDATE campaign_lead_activities 
       SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, errorMessage, activityId]
    );
  }

  /**
   * Validate step configuration
   */
  validateStepConfig(stepType, stepConfig) {
    const requiredFields = {
      linkedin_connect: [],
      linkedin_message: ['message'],
      email_send: ['subject', 'body'],
      email_followup: ['subject', 'body'],
      voice_agent_call: ['voiceAgentId', 'voiceContext'],
      delay: ['delayDays', 'delayHours'],
    };

    const required = requiredFields[stepType] || [];
    const missing = required.filter(field => !stepConfig[field]);

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missing.join(', ')}`
      };
    }

    return { valid: true };
  }
}

module.exports = new StepExecutor();
