/**
 * Campaign Execution Service
 * Main entry point that imports and re-exports all campaign execution functions
 * This file maintains backward compatibility while delegating to split modules
 */

// Import all functions from split modules
const { 
  executeStepForLead, 
  processCampaign 
} = require('./CampaignProcessor');
const { processLeadThroughWorkflow } = require('./WorkflowProcessor');

const { 
  getRequiredFieldsForStepType,
  isFieldValid,
  isDelayValid,
  validateStepConfig,
  getChannelForStepType
} = require('./StepValidators');

const { executeLeadGeneration } = require('./LeadGenerationService');

const { 
  getLeadData,
  executeEmailStep,
  executeWhatsAppStep,
  executeInstagramStep,
  executeVoiceAgentStep,
  executeDelayStep,
  executeConditionStep
} = require('./StepExecutors');

const { executeLinkedInStep } = require('./LinkedInStepExecutor');

// Re-export all functions for backward compatibility
// Note: processCampaign now accepts authToken as third parameter
module.exports = {
  // Main processing functions
  executeStepForLead,
  processCampaign, // Now accepts (campaignId, tenantId, authToken)
  processLeadThroughWorkflow,
  
  // Validation functions
  getRequiredFieldsForStepType,
  isFieldValid,
  isDelayValid,
  validateStepConfig,
  getChannelForStepType,
  
  // Step execution functions
  executeLeadGeneration,
  executeLinkedInStep,
  executeEmailStep,
  executeWhatsAppStep,
  executeInstagramStep,
  executeVoiceAgentStep,
  executeDelayStep,
  executeConditionStep,
  
  // Helper functions
  getLeadData
};
