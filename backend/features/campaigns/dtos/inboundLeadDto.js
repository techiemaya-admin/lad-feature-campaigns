const { randomUUID } = require('crypto');

/**
 * Data Transfer Objects for inbound leads
 * Handles transformation between camelCase (API) and snake_case (DB)
 */

/**
 * Transform uploaded lead data for database insertion
 * @param {Object} leadData - Lead data from upload (camelCase)
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Transformed lead data for repository (snake_case)
 */
function transformUploadedLead(leadData, tenantId) {
  // Parse name if firstName/lastName not provided
  let firstName = leadData.firstName || '';
  let lastName = leadData.lastName || '';
  
  if (!firstName && !lastName) {
    const name = leadData.name || '';
    if (name) {
      const nameParts = name.split(' ');
      firstName = nameParts[0] || '';
      lastName = nameParts.slice(1).join(' ') || '';
    }
  }
  
  return {
    tenantId,
    source: 'inbound_upload',
    sourceId: randomUUID(),
    firstName: firstName || null,
    lastName: lastName || null,
    email: leadData.email || null,
    phone: leadData.phone || leadData.whatsapp || null,
    companyName: leadData.companyName || null,
    title: leadData.title || null,
    linkedinUrl: leadData.linkedinProfile || null,
    customFields: JSON.stringify({
      whatsapp: leadData.whatsapp,
      website: leadData.website,
      notes: leadData.notes
    }),
    rawData: JSON.stringify(leadData)
  };
}

/**
 * Transform duplicate detection result for API response
 * @param {Object} duplicate - Duplicate detection result
 * @returns {Object} Formatted duplicate info
 */
function transformDuplicateResponse(duplicate) {
  return {
    uploadedLead: duplicate.uploadedLead,
    existingLead: {
      id: duplicate.existingLead.id,
      firstName: duplicate.existingLead.first_name,
      lastName: duplicate.existingLead.last_name,
      email: duplicate.existingLead.email,
      phone: duplicate.existingLead.phone,
      companyName: duplicate.existingLead.company_name,
      title: duplicate.existingLead.title,
      linkedinUrl: duplicate.existingLead.linkedin_url,
      createdAt: duplicate.existingLead.created_at
    },
    matchedOn: duplicate.matchedOn,
    bookings: duplicate.bookings.map(booking => ({
      id: booking.id,
      scheduledAt: booking.scheduled_at,
      status: booking.status,
      bookingType: booking.booking_type,
      notes: booking.notes
    }))
  };
}

/**
 * Transform database lead to API response format
 * @param {Object} dbLead - Lead from database (snake_case)
 * @returns {Object} API-formatted lead (camelCase)
 */
function transformLeadToResponse(dbLead) {
  return {
    id: dbLead.id,
    tenantId: dbLead.tenant_id,
    source: dbLead.source,
    sourceId: dbLead.source_id,
    firstName: dbLead.first_name,
    lastName: dbLead.last_name,
    email: dbLead.email,
    phone: dbLead.phone,
    companyName: dbLead.company_name,
    title: dbLead.title,
    linkedinUrl: dbLead.linkedin_url,
    customFields: dbLead.custom_fields,
    rawData: dbLead.raw_data,
    createdAt: dbLead.created_at,
    updatedAt: dbLead.updated_at
  };
}

module.exports = {
  transformUploadedLead,
  transformDuplicateResponse,
  transformLeadToResponse
};
