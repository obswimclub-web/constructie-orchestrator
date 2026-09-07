import type { Express } from 'express';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

describe('P12 Cross-Site Auth & CORS Enforcement', () => {
  
  let app: Express;
  const originalEnv = process.env.NODE_ENV;
  const originalOrigin = process.env.WEB_ORIGIN;
  const originalBootstrap = process.env.OWNER_BOOTSTRAP_KEY;
  const originalSecret = process.env.SESSION_SECRET;
  let realValidCookie: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = 'https://coweb-production.up.railway.app';
    process.env.OWNER_BOOTSTRAP_KEY = 'test-owner-key';
    process.env.SESSION_SECRET = 'test-session-secret';

    // Clear module cache to guarantee the environment is evaluated freshly
    vi.resetModules();

    const module = await import('../../apps/api/src/index');
    app = module.app;

    // Perform a real login flow to obtain the cookie dynamically
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ bootstrapKey: 'test-owner-key' });
    
    // Extract the raw cookie string for subsequent tests
    const rawSetCookie = loginRes.headers['set-cookie'][0];
    realValidCookie = rawSetCookie.split(';')[0];
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
    if (originalOrigin === undefined) delete process.env.WEB_ORIGIN; else process.env.WEB_ORIGIN = originalOrigin;
    if (originalBootstrap === undefined) delete process.env.OWNER_BOOTSTRAP_KEY; else process.env.OWNER_BOOTSTRAP_KEY = originalBootstrap;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
  });

  it('sets SameSite=None and Secure=true in production', async () => {
    const res = await request(app).post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'][0];
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Secure');
  });

  it('rejects CORS for unauthorized origins', async () => {
    const res = await request(app).options('/api/auth/session')
      .set('Origin', 'https://evil-site.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows CORS for exactly WEB_ORIGIN', async () => {
    const res = await request(app).options('/api/auth/session')
      .set('Origin', 'https://coweb-production.up.railway.app');
    expect(res.headers['access-control-allow-origin']).toBe('https://coweb-production.up.railway.app');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('fails closed on CSRF (POST with real cookie but missing Origin)', async () => {
    const res = await request(app).post('/api/auth/logout')
      .set('Cookie', realValidCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('missing origin for cookie session');
  });

  it('fails closed on CSRF (POST with real cookie and wrong Origin)', async () => {
    const res = await request(app).post('/api/auth/logout')
      .set('Cookie', realValidCookie)
      .set('Origin', 'https://evil-site.com');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('invalid origin');
  });

  it('allows state-changing request with real cookie and exact Origin', async () => {
    const res = await request(app).post('/api/auth/logout')
      .set('Cookie', realValidCookie)
      .set('Origin', 'https://coweb-production.up.railway.app');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    
    const setCookie = res.headers['set-cookie'][0];
    expect(setCookie).toContain('SameSite=None');
  });

  it('rejects tampered cookie strictly', async () => {
    const tamperedCookie = realValidCookie + 'invalidated';
    const res = await request(app).post('/api/projects')
      .set('Cookie', tamperedCookie)
      .set('Origin', 'https://coweb-production.up.railway.app')
      .send({ name: 'tampered', slug: 'tampered' });
    expect(res.status).toBe(401); // 401 from auth check, before/after CSRF
  });

  it('rejects malformed cookie gracefully', async () => {
    const malformedCookie = 'co_session=just_garbage_without_signature';
    const res = await request(app).post('/api/projects')
      .set('Cookie', malformedCookie)
      .set('Origin', 'https://coweb-production.up.railway.app')
      .send({ name: 'malformed', slug: 'malformed' });
    expect(res.status).toBe(401);
  });

  it('fails closed on CSRF (POST with malformed cookie and missing Origin)', async () => {
    const malformedCookie = 'co_session=just_garbage_without_signature';
    const res = await request(app).post('/api/projects')
      .set('Cookie', malformedCookie)
      .send({ name: 'malformed', slug: 'malformed' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('missing origin for cookie session');
  });

  it('fails closed on CSRF (POST with tampered cookie and missing Origin)', async () => {
    const tamperedCookie = realValidCookie + 'invalidated';
    const res = await request(app).post('/api/projects')
      .set('Cookie', tamperedCookie)
      .send({ name: 'tampered', slug: 'tampered' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('missing origin for cookie session');
  });

  it('fails closed on CSRF (POST with expired cookie and missing Origin)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1000);
      const res = await request(app).post('/api/projects')
        .set('Cookie', realValidCookie)
        .send({ name: 'expired', slug: 'expired' });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('missing origin for cookie session');
    } finally {
      vi.useRealTimers();
    }
  });

});
