const { pool } = require('../../../shared/database/connection');
const stepExecutor = require('./stepExecutor');
const conditionEvaluator = require('./conditionEvaluator');

/**
 * Main workflow execution engine
 * Orchestrates campaign workflow execution, step transitions, and state management
 */
class WorkflowEngine {
  /**
   * Process a campaign - execute all steps for all leads
   */
  async processCampaign(campaignId, userId, orgId) {
    try {
      console.log(`[WorkflowEngine] Processing campaign ${campaignId}...`);

      // Get campaign details
      const campaignResult = await pool.query(
        'SELECT * FROM campaigns WHERE id = $1',
        [campaignId]
      );

      if (campaignResult.rows.length === 0) {
        throw new Error('Campaign not found');
      }

      const campaign = campaignResult.rows[0];
      console.log(`[WorkflowEngine] Campaign: ${campaign.name}`);

      // Parse workflow
      const workflow = typeof campaign.workflow === 'string' 
        ? JSON.parse(campaign.workflow) 
        : campaign.workflow;

      if (!workflow || !workflow.steps) {
        throw new Error('Invalid workflow configuration');
      }

      // Get all leads for this campaign
      const leadsResult = await pool.query(
        'SELECT * FROM campaign_leads WHERE campaign_id = $1',
        [campaignId]
      );

      console.log(`[WorkflowEngine] Found ${leadsResult.rows.length} leads`);

      // Process each lead through the workflow
      for (const lead of leadsResult.rows) {
        await this.processLeadWorkflow(campaignId, lead, workflow, userId, orgId);
      }

      console.log(`[WorkflowEngine] Campaign ${campaignId} processing complete`);
      return { success: true };
    } catch (error) {
      console.error(`[WorkflowEngine] Error processing campaign:`, error);
      throw error;
    }
  }

  /**
   * Process a single lead through the workflow
   */
  async processLeadWorkflow(campaignId, lead, workflow, userId, orgId) {
    try {
      console.log(`[WorkflowEngine] Processing lead ${lead.id} for campaign ${campaignId}`);

      // Get current step for this lead
      let currentStepId = lead.current_step_id;

      // If no current step, start from the first step
      if (!currentStepId) {
        const startStep = workflow.steps.find(s => s.type === 'start');
        if (!startStep) {
          throw new Error('No start step found in workflow');
        }
        currentStepId = startStep.id;
      }

      // Execute steps until we reach an end step or pending delay
      let maxIterations = 100; // Prevent infinite loops
      let iterations = 0;

      while (currentStepId && iterations < maxIterations) {
        iterations++;

        const currentStep = workflow.steps.find(s => s.id === currentStepId);
        if (!currentStep) {
          console.error(`[WorkflowEngine] Step ${currentStepId} not found in workflow`);
          break;
        }

        console.log(`[WorkflowEngine] Executing step ${currentStep.id} (${currentStep.type})`);

        // Execute the step
        const result = await stepExecutor.executeStepForLead(
          campaignId,
          lead,
          currentStep,
          userId,
          orgId
        );

        if (!result.success) {
          console.error(`[WorkflowEngine] Step execution failed: ${result.error}`);
          break;
        }

        // If step is a delay and not yet completed, stop here
        if (currentStep.type === 'delay' && result.delayPending) {
          console.log(`[WorkflowEngine] Delay pending until ${result.delayUntil}`);
          break;
        }

        // Determine next step
        currentStepId = await this.getNextStep(currentStep, lead, workflow, result);

        // Update lead's current step
        await pool.query(
          'UPDATE campaign_leads SET current_step_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [currentStepId, lead.id]
        );

        // If we've reached an end step, break
        if (currentStep.type === 'end') {
          console.log(`[WorkflowEngine] Reached end step for lead ${lead.id}`);
          break;
        }
      }

      if (iterations >= maxIterations) {
        console.warn(`[WorkflowEngine] Max iterations reached for lead ${lead.id}`);
      }

      return { success: true };
    } catch (error) {
      console.error(`[WorkflowEngine] Error processing lead workflow:`, error);
      throw error;
    }
  }

  /**
   * Determine the next step based on current step and conditions
   */
  async getNextStep(currentStep, lead, workflow, executionResult) {
    // If it's a condition step, evaluate the condition
    if (currentStep.type === 'condition') {
      const conditionMet = await conditionEvaluator.evaluateCondition(
        currentStep,
        lead,
        executionResult
      );

      // Find the edge that matches the condition result
      const edge = workflow.edges?.find(e => 
        e.source === currentStep.id && 
        e.sourceHandle === (conditionMet ? 'yes' : 'no')
      );

      return edge ? edge.target : null;
    }

    // For other steps, follow the default edge
    const edge = workflow.edges?.find(e => e.source === currentStep.id);
    return edge ? edge.target : null;
  }

  /**
   * Get all pending delayed leads that are ready to execute
   */
  async getPendingDelayedLeads() {
    try {
      const result = await pool.query(`
        SELECT DISTINCT cl.*, c.workflow, c.user_id, c.org_id
        FROM campaign_leads cl
        JOIN campaigns c ON cl.campaign_id = c.id
        JOIN campaign_lead_activities cla ON cl.id = cla.lead_id
        WHERE cla.status = 'pending'
          AND cla.scheduled_at <= CURRENT_TIMESTAMP
          AND c.status = 'active'
      `);

      return result.rows;
    } catch (error) {
      console.error('[WorkflowEngine] Error getting pending delayed leads:', error);
      return [];
    }
  }
}

module.exports = new WorkflowEngine();
