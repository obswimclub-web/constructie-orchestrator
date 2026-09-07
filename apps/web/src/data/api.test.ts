import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkSession, loginWithBootstrap } from './api';

describe('Web API Client - Auth Regression', () => {
  const originalFetch = global.fetch;
  let mockFetch: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('loginWithBootstrap POSTs to /api/auth/login and checkSession GETs /api/auth/session', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true }); // for login
    await loginWithBootstrap('test-key');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/login'), expect.objectContaining({ method: 'POST', credentials: 'include' }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authenticated: true, projectBound: true })
    }); // for session

    const session = await checkSession();
    expect(session.authenticated).toBe(true);
    expect(session.projectBound).toBe(true);

    // Verify it correctly called the API endpoint, NOT the 404 route
    expect(mockFetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/auth/session'), expect.objectContaining({ credentials: 'include' }));
    // Explicitly reject the buggy '/auth/session'
    const lastCallUrl = mockFetch.mock.calls[1][0];
    expect(lastCallUrl.endsWith('/api/auth/session')).toBe(true);
  });
});
