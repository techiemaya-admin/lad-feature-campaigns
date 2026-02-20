/**
 * Error Constants for LAD Architecture
 * Centralized error codes and HTTP status codes for consistent error handling
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

// Application Error Codes
const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  
  // Validation Errors
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  VALIDATION_CONSTRAINT_VIOLATION: 'VALIDATION_CONSTRAINT_VIOLATION',
  
  // Booking System
  BOOKING_INVALID_TIMESLOT: 'BOOKING_INVALID_TIMESLOT',
  BOOKING_SLOT_UNAVAILABLE: 'BOOKING_SLOT_UNAVAILABLE',
  BOOKING_VALIDATION_FAILED: 'BOOKING_VALIDATION_FAILED',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_ALREADY_EXISTS: 'BOOKING_ALREADY_EXISTS',
  
  // Leads & Pipeline
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  LEAD_ASSIGNMENT_FAILED: 'LEAD_ASSIGNMENT_FAILED',
  LEAD_VALIDATION_FAILED: 'LEAD_VALIDATION_FAILED',
  
  // Database Operations
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  DATABASE_QUERY_FAILED: 'DATABASE_QUERY_FAILED',
  DATABASE_CONSTRAINT_VIOLATION: 'DATABASE_CONSTRAINT_VIOLATION',
  
  // Multi-tenancy
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_ACCESS_DENIED: 'TENANT_ACCESS_DENIED',
  TENANT_VALIDATION_FAILED: 'TENANT_VALIDATION_FAILED',
  
  // Feature Flags & Capabilities
  FEATURE_NOT_ENABLED: 'FEATURE_NOT_ENABLED',
  CAPABILITY_NOT_AVAILABLE: 'CAPABILITY_NOT_AVAILABLE',
  
  // External Services
  EXTERNAL_SERVICE_UNAVAILABLE: 'EXTERNAL_SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_RATE_LIMITED: 'EXTERNAL_SERVICE_RATE_LIMITED',
  
  // Voice Agent
  VOICE_AGENT_NOT_FOUND: 'VOICE_AGENT_NOT_FOUND',
  VOICE_CALL_FAILED: 'VOICE_CALL_FAILED',
  VOICE_TRANSCRIPTION_FAILED: 'VOICE_TRANSCRIPTION_FAILED',
  
  // Generic
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  OPERATION_FAILED: 'OPERATION_FAILED',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR'
};

// Error Response Templates
const createErrorResponse = (code, message, details = null, httpStatus = HTTP_STATUS.INTERNAL_SERVER_ERROR) => {
  const response = {
    success: false,
    error: message,
    code
  };
  
  if (details) {
    response.details = details;
  }
  
  return { response, status: httpStatus };
};

// Common Error Responses
const ERROR_RESPONSES = {
  BOOKING_VALIDATION_FAILED: (details) => 
    createErrorResponse(
      ERROR_CODES.BOOKING_VALIDATION_FAILED,
      'Booking validation failed',
      details,
      HTTP_STATUS.BAD_REQUEST
    ),
    
  BOOKING_NOT_FOUND: () =>
    createErrorResponse(
      ERROR_CODES.BOOKING_NOT_FOUND,
      'Booking not found',
      null,
      HTTP_STATUS.NOT_FOUND
    ),
    
  LEAD_NOT_FOUND: () =>
    createErrorResponse(
      ERROR_CODES.LEAD_NOT_FOUND,
      'Lead not found',
      null,
      HTTP_STATUS.NOT_FOUND
    ),
    
  TENANT_ACCESS_DENIED: () =>
    createErrorResponse(
      ERROR_CODES.TENANT_ACCESS_DENIED,
      'Access denied for tenant',
      null,
      HTTP_STATUS.FORBIDDEN
    ),
    
  VALIDATION_FAILED: (details) =>
    createErrorResponse(
      ERROR_CODES.VALIDATION_REQUIRED_FIELD,
      'Required field validation failed',
      details,
      HTTP_STATUS.BAD_REQUEST
    ),
    
  DATABASE_ERROR: (details) =>
    createErrorResponse(
      ERROR_CODES.DATABASE_QUERY_FAILED,
      'Database operation failed',
      details,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    ),
    
  UNEXPECTED_ERROR: (details) =>
    createErrorResponse(
      ERROR_CODES.UNEXPECTED_ERROR,
      'An unexpected error occurred',
      details,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
};

module.exports = {
  HTTP_STATUS,
  ERROR_CODES,
  ERROR_RESPONSES,
  createErrorResponse
};