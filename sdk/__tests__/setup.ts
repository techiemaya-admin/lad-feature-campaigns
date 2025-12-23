/**
 * Test Setup for Campaigns SDK
 * 
 * Mocks the shared API client to prevent real backend calls
 */

import { vi } from 'vitest';

// Mock shared api client used by SDK
vi.mock('@/sdk/shared/apiClient', () => {
  return {
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});
