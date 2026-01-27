/**
 * LinkedIn Profile Helper
 * Handles profile URL extraction and checkpoint detection
 */
/**
 * Extract LinkedIn profile URL from Unipile response
 * Checks all possible fields that Unipile might return (like pluto_campaigns)
 * @param {Object} unipileResponse - Response from Unipile API
 * @returns {string|null} LinkedIn profile URL or null
 */
function extractLinkedInProfileUrl(unipileResponse) {
  if (!unipileResponse) return null;
  // Check all possible fields in order of preference
  // Unipile may return profile URL in different fields depending on the API endpoint
  const possibleFields = [
    unipileResponse.profile_url,
    unipileResponse.public_profile_url,
    unipileResponse.profile?.profile_url,
    unipileResponse.profile?.public_profile_url,
    unipileResponse.profile?.url,
    unipileResponse.url,
    // Check nested profile object
    unipileResponse.profile?.profile?.url,
    unipileResponse.profile?.profile?.profile_url,
    unipileResponse.profile?.profile?.public_profile_url,
  ];
  // Find first valid URL
  for (const url of possibleFields) {
    if (url && typeof url === 'string' && url.trim() !== '') {
      const trimmedUrl = url.trim();
      // Validate it's a LinkedIn URL
      if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
        // Ensure it's a LinkedIn URL
        if (trimmedUrl.includes('linkedin.com')) {
          return trimmedUrl;
        }
      }
    }
  }
  // Check connection_params.im.publicIdentifier (this is where Unipile stores it in account list responses)
  if (unipileResponse.connection_params?.im?.publicIdentifier) {
    const publicIdentifier = unipileResponse.connection_params.im.publicIdentifier;
    if (typeof publicIdentifier === 'string' && publicIdentifier.trim() !== '') {
      const constructedUrl = `https://www.linkedin.com/in/${publicIdentifier.trim()}`;
      return constructedUrl;
    }
  }
  // Also check connection_params.im.id (fallback if publicIdentifier not available)
  if (unipileResponse.connection_params?.im?.id) {
    const imId = unipileResponse.connection_params.im.id;
    // Only use if it looks like a LinkedIn profile ID (starts with ACoA or is numeric)
    if (typeof imId === 'string' && (imId.startsWith('ACoA') || /^\d+$/.test(imId))) {
      // For numeric IDs, we need to use a different format, but publicIdentifier is preferred
      // Skip this for now as we'd need to fetch the profile to get the publicIdentifier
    }
  }
  // If we have a profile ID, we could construct URL, but only if we're sure it's correct
  // Don't construct from email username as that's usually wrong
  if (unipileResponse.profile?.id) {
    const profileId = unipileResponse.profile.id;
    // Only construct if it looks like a valid LinkedIn profile ID (not email-based)
    if (typeof profileId === 'string' && profileId.length > 0 && !profileId.includes('@')) {
      const constructedUrl = `https://www.linkedin.com/in/${profileId}`;
      return constructedUrl;
    }
  }
  
  return null;
}
/**
 * Detect checkpoint type and extract checkpoint information
 */
function detectCheckpoint(account, unipile = null) {
  if (!account || account.object !== 'Checkpoint' || !account.checkpoint) {
    return null;
  }
  const checkpointType = account.checkpoint.type || 'IN_APP_VALIDATION';
  const hasCodeField = !!account.checkpoint.code;
  const hasChallengeField = !!account.checkpoint.challenge;
  const isOTP = hasCodeField || hasChallengeField || checkpointType === 'OTP' || checkpointType === 'SMS' || checkpointType === 'EMAIL';
  const isYesNo = !isOTP && (checkpointType === 'IN_APP_VALIDATION' || checkpointType === 'YES_NO');
  return {
    type: checkpointType,
    isOTP,
    isYesNo,
    checkpoint: account.checkpoint
  };
}
/**
 * Extract checkpoint information from account response
 */
async function extractCheckpointInfo(account, unipile, accountId) {
  if (!account || account.object !== 'Checkpoint' || !account.checkpoint) {
    return null;
  }
  const checkpointDetection = detectCheckpoint(account, unipile);
  if (!checkpointDetection) {
    return null;
  }
  // Try to fetch account details for more checkpoint information
  let checkpointMessage = null;
  let checkpointSentTo = null;
  let checkpointExpiresAt = null;
  try {
    if (unipile && unipile.account && typeof unipile.account.getOne === 'function') {
      const accountDetails = await unipile.account.getOne(accountId);
      if (accountDetails?.checkpoint) {
        checkpointMessage = accountDetails.checkpoint.message;
        checkpointSentTo = accountDetails.checkpoint.sent_to || accountDetails.checkpoint.sentTo;
        checkpointExpiresAt = accountDetails.checkpoint.expires_at || accountDetails.checkpoint.expiresAt;
      }
    }
  } catch (detailError) {
  }
  // Extract checkpoint fields from response
  const checkpointObj = account.checkpoint || {};
  checkpointMessage = checkpointMessage || checkpointObj.message || checkpointObj.description;
  checkpointSentTo = checkpointSentTo || checkpointObj.sent_to || checkpointObj.sentTo;
  checkpointExpiresAt = checkpointExpiresAt || checkpointObj.expires_at || checkpointObj.expiresAt;
  return {
    object: 'Checkpoint',
    account_id: accountId,
    checkpoint: {
      type: checkpointDetection.type,
      required: true,
      is_yes_no: checkpointDetection.isYesNo,
      is_otp: checkpointDetection.isOTP,
      message: checkpointMessage,
      sent_to: checkpointSentTo,
      expires_at: checkpointExpiresAt
    }
  };
}
module.exports = {
  extractLinkedInProfileUrl,
  detectCheckpoint,
  extractCheckpointInfo
};
