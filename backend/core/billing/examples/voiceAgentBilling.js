const billingService = require('../../../core/billing/services/billingService');
const { v4: uuidv4 } = require('uuid');

/**
 * Billing Integration Helper for Voice Agent Feature
 * 
 * This demonstrates how features should emit usage to the billing system
 * WITHOUT implementing their own billing logic.
 * 
 * Usage Pattern:
 * 1. Feature executes operation (e.g., voice call)
 * 2. Feature collects usage metrics (STT seconds, LLM tokens, TTS chars, etc.)
 * 3. Feature calls recordVoiceCallUsage() with idempotency key (call_id)
 * 4. Billing service handles pricing, wallet debit, and ledger
 */

/**
 * Record voice call usage and charge to tenant wallet
 * Supports multi-component billing (STT + LLM + TTS + Telephony + VM)
 * 
 * @param {Object} params
 * @param {string} params.tenantId - Tenant UUID
 * @param {string} params.userId - User UUID
 * @param {string} params.callId - Unique call ID (used for idempotency)
 * @param {Object} params.usage - Usage metrics
 * @param {number} params.usage.sttSeconds - Speech-to-text duration
 * @param {string} params.usage.sttProvider - e.g., 'openai'
 * @param {string} params.usage.sttModel - e.g., 'whisper-1'
 * @param {number} params.usage.llmPromptTokens - LLM input tokens
 * @param {number} params.usage.llmCompletionTokens - LLM output tokens
 * @param {string} params.usage.llmProvider - e.g., 'openai'
 * @param {string} params.usage.llmModel - e.g., 'gpt-4'
 * @param {number} params.usage.ttsCharacters - Text-to-speech characters
 * @param {string} params.usage.ttsProvider - e.g., 'openai'
 * @param {string} params.usage.ttsModel - e.g., 'tts-1'
 * @param {number} params.usage.telephonyMinutes - Telephony duration in minutes
 * @param {string} params.usage.telephonyProvider - e.g., 'twilio'
 * @param {number} params.usage.vmSeconds - VM infrastructure seconds
 * @param {string} params.usage.vmProvider - e.g., 'runpod'
 * @param {Object} params.metadata - Additional metadata
 * @returns {Promise<Object>} { usageEvent, ledgerTransaction }
 */
async function recordVoiceCallUsage({
  tenantId,
  userId,
  callId,
  usage,
  metadata = {}
}) {
  const items = [];
  
  // STT (Speech-to-Text)
  if (usage.sttSeconds > 0) {
    items.push({
      category: 'stt',
      provider: usage.sttProvider || 'openai',
      model: usage.sttModel || 'whisper-1',
      unit: 'second',
      quantity: usage.sttSeconds,
      description: `STT processing for ${usage.sttSeconds}s`
    });
  }
  
  // LLM Prompt Tokens
  if (usage.llmPromptTokens > 0) {
    items.push({
      category: 'llm',
      provider: usage.llmProvider || 'openai',
      model: usage.llmModel || 'gpt-4',
      unit: 'token',
      quantity: usage.llmPromptTokens,
      description: `LLM prompt tokens: ${usage.llmPromptTokens}`
    });
  }
  
  // LLM Completion Tokens
  if (usage.llmCompletionTokens > 0) {
    items.push({
      category: 'llm',
      provider: usage.llmProvider || 'openai',
      model: usage.llmModel || 'gpt-4',
      unit: 'token',
      quantity: usage.llmCompletionTokens,
      description: `LLM completion tokens: ${usage.llmCompletionTokens}`
    });
  }
  
  // TTS (Text-to-Speech)
  if (usage.ttsCharacters > 0) {
    items.push({
      category: 'tts',
      provider: usage.ttsProvider || 'openai',
      model: usage.ttsModel || 'tts-1',
      unit: 'character',
      quantity: usage.ttsCharacters,
      description: `TTS generation for ${usage.ttsCharacters} chars`
    });
  }
  
  // Telephony (Phone Call)
  if (usage.telephonyMinutes > 0) {
    items.push({
      category: 'telephony',
      provider: usage.telephonyProvider || 'twilio',
      model: 'voice',
      unit: 'minute',
      quantity: usage.telephonyMinutes,
      description: `Voice call duration: ${usage.telephonyMinutes} min`
    });
  }
  
  // VM Infrastructure
  if (usage.vmSeconds > 0) {
    items.push({
      category: 'vm_infrastructure',
      provider: usage.vmProvider || 'runpod',
      model: usage.vmModel || 'cpu-basic',
      unit: 'second',
      quantity: usage.vmSeconds,
      description: `VM infrastructure: ${usage.vmSeconds}s`
    });
  }
  
  if (items.length === 0) {
    throw new Error('No usage items provided');
  }
  
  // Create and charge usage event (idempotent by callId)
  const result = await billingService.createAndChargeUsageEvent({
    tenantId,
    userId,
    featureKey: 'voice-agent',
    items,
    idempotencyKey: `voice_call_${callId}`,
    externalReferenceId: callId,
    metadata: {
      ...metadata,
      callId,
      component: 'voice-agent'
    }
  });
  
  console.log(`[Voice Agent] Charged call ${callId}: $${result.usageEvent.total_cost}`);
  
  return result;
}

/**
 * Quote voice call cost before execution
 * Use this to show estimated cost to user before making the call
 */
async function quoteVoiceCallCost({ tenantId, estimatedDuration }) {
  // Estimate usage based on typical call patterns
  const estimatedMinutes = estimatedDuration / 60;
  
  const items = [
    // Assume 80% of call time is STT
    { category: 'stt', provider: 'openai', model: 'whisper-1', unit: 'second', quantity: estimatedDuration * 0.8 },
    // Assume ~100 tokens per minute for LLM
    { category: 'llm', provider: 'openai', model: 'gpt-4', unit: 'token', quantity: estimatedMinutes * 100 },
    // Assume ~50 chars per minute for TTS
    { category: 'tts', provider: 'openai', model: 'tts-1', unit: 'character', quantity: estimatedMinutes * 50 },
    // Telephony full duration
    { category: 'telephony', provider: 'twilio', model: 'voice', unit: 'minute', quantity: estimatedMinutes },
    // VM matches call duration
    { category: 'vm_infrastructure', provider: 'runpod', model: 'cpu-basic', unit: 'second', quantity: estimatedDuration }
  ];
  
  return billingService.quote({ tenantId, items });
}

/**
 * Check if tenant has sufficient balance for estimated call
 */
async function canAffordCall({ tenantId, estimatedDuration }) {
  const quote = await quoteVoiceCallCost({ tenantId, estimatedDuration });
  const wallet = await billingService.getWalletBalance(tenantId);
  
  return {
    canAfford: wallet.availableBalance >= quote.totalCost,
    estimatedCost: quote.totalCost,
    currentBalance: wallet.currentBalance,
    availableBalance: wallet.availableBalance,
    quote
  };
}

module.exports = {
  recordVoiceCallUsage,
  quoteVoiceCallCost,
  canAffordCall
};
