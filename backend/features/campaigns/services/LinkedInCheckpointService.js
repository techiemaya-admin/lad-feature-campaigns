/**
 * LinkedIn Checkpoint Service
 * Handles checkpoint detection and processing for LinkedIn OAuth
 */

const { extractCheckpointInfo } = require('./LinkedInProfileHelper');

/**
 * Handle checkpoint response from Unipile SDK
 */
async function handleCheckpointResponse(account, unipile, email = null) {
  if (!account || account.object !== 'Checkpoint' || !account.checkpoint) {
    return null;
  }
  
  // Extract account ID from checkpoint response
  const accountId = account.account_id || account.id || account._id;
  
  if (!accountId) {
    throw new Error('LinkedIn requires verification, but no account ID was returned.');
  }
  
  console.log('[LinkedIn Checkpoint] ⚠️ Checkpoint required:', account.checkpoint.type);
  
  // Extract checkpoint information
  const checkpointInfo = await extractCheckpointInfo(account, unipile, accountId);
  
  if (!checkpointInfo) {
    throw new Error('Failed to extract checkpoint information');
  }
  
  // Add email and profileName if provided
  if (email) {
    checkpointInfo.email = email;
    checkpointInfo.profileName = email.split('@')[0];
  } else if (account.profile_name) {
    checkpointInfo.profileName = account.profile_name;
    checkpointInfo.email = account.email || null;
  }
  
  return checkpointInfo;
}

module.exports = {
  handleCheckpointResponse
};
