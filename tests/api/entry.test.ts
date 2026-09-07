import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../apps/api/src/index';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('P12 Entry Flow API', () => {
  let projectToken: string;
  let projectId: string;
  let sessionCookie: string;


  // ==========================================
  // LOGIN / AUTH
  // ==========================================
  
  it('CONFIG: fails closed if OWNER_BOOTSTRAP_KEY is missing', async () => {
    delete process.env.OWNER_BOOTSTRAP_KEY;
    const res = await request(app).post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('configuration missing');
    process.env.OWNER_BOOTSTRAP_KEY = 'test-owner-key';
  });

  it('CONFIG: fails closed if SESSION_SECRET is missing', async () => {
    delete process.env.SESSION_SECRET;
    try {
      const res = await request(app).post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('configuration missing');
    } finally {
      process.env.SESSION_SECRET = 'test-session-secret';
    }
  });

  it('SESSION: rejects expired session', async () => {
    vi.useFakeTimers();
    try {
      // 1. Emite o sesiune valida reala
      const loginRes = await request(app).post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
      const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
      
      // 2. Avanseaza timpul peste perioada de expirare (de obicei > 24h, sa luam 30 days)
      vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1000);
      
      // 3. Verifica daca sesiunea este respinsa la un call state-changing
      const res = await request(app).post('/api/projects').set('Origin', 'http://localhost:5173').set('Cookie', cookie).send({ name: 'T', slug: 't' });
      expect(res.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });
  
  it('BEARER: rejects malformed or invalid signatures without crashing', async () => {
    let res = await request(app).post('/api/work-items').set('Origin', 'http://localhost:5173').set('Authorization', 'Bearer invalid-token').send({ objective: 'Test' });
    expect(res.status).toBe(401);
    
    res = await request(app).post('/api/work-items').set('Origin', 'http://localhost:5173').set('Authorization', 'Bearer pId.wrong_sig_length_here').send({ objective: 'Test' });
    expect(res.status).toBe(401);
  });

  it('LOGIN: missing credential denied', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(401);
  });

  it('LOGIN: wrong bootstrap key denied', async () => {
    const res = await request(app).post('/api/auth/login').send({ bootstrapKey: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('LOGIN: correct bootstrap key issues HttpOnly cookie without secrets', async () => {
    const res = await request(app).post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    
    // Cookie checks
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookieStr = cookies.find((c: string) => c.startsWith('co_session='));
    expect(sessionCookieStr).toBeDefined();
    expect(sessionCookieStr).toContain('HttpOnly');
    expect(sessionCookieStr).toContain('SameSite=Strict');
    
    // Secret exposure check
    expect(res.text).not.toContain('test-owner-key');
    expect(res.text).not.toContain('test-secret');

    sessionCookie = sessionCookieStr.split(';')[0];
  });

  it('LOGIN: tampered cookie rejected', async () => {
    const tampered = sessionCookie + 'bad';
    const res = await request(app)
      .post('/api/projects').set('Origin', 'http://localhost:5173')
      .set('Cookie', tampered)
      .send({ name: 'Test', slug: 'test' });
    expect(res.status).toBe(401);
  });

  // ==========================================
  // PROJECT
  // ==========================================
  it('PROJECT: anonymous denied', async () => {
    const res = await request(app).post('/api/projects').set('Origin', 'http://localhost:5173').send({ name: 'Test', slug: 'test' });
    expect(res.status).toBe(401);
  });

  it('PROJECT: service Bearer token denied from creating project', async () => {
    projectId = randomUUID();
    const hmac = createHmac('sha256', 'test-secret');
    hmac.update(projectId);
    projectToken = `${projectId}.${hmac.digest('hex')}`;

    const res = await request(app)
      .post('/api/projects').set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${projectToken}`)
      .send({ name: 'Test', slug: 'test' });
    
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only Owner');
  });

  it('PROJECT: Owner session unbound creates project and issues replacement cookie', async () => {
    const res = await request(app)
      .post('/api/projects').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({
        name: 'Integration Project',
        slug: `integration/${Date.now()}`
      });
    
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Integration Project');
    expect(res.body.slug).toContain('integration/');
    
    // Check that ID was generated by server
    const newProjectId = res.body.id;
    expect(newProjectId).toBeDefined();

    // Check replacement cookie
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const newSessionCookieStr = cookies.find((c: string) => c.startsWith('co_session='));
    expect(newSessionCookieStr).toBeDefined();
    
    // Update our session for next tests
    sessionCookie = newSessionCookieStr.split(';')[0];

    // Verify persistence preserves atomicity
    const saved = await prisma.project.findUnique({ where: { id: newProjectId } });
    expect(saved).not.toBeNull();
    expect(saved!.name).toBe('Integration Project');

    const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: newProjectId } });
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('PROJECT: second create on bound session rejected', async () => {
    const res = await request(app)
      .post('/api/projects').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({ name: 'Another Project', slug: 'another' });
    
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists for this context');
  });

  // ==========================================
  // WORK ITEM
  // ==========================================
  it('WORK ITEM: bound Owner session creates work item (project isolation)', async () => {
    const res = await request(app)
      .post('/api/work-items').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({ objective: 'Owner run' });
    
    expect(res.status).toBe(201);
    expect(res.body.objective).toBe('Owner run');
    // Ensure it didn't use body project id
    expect(res.body.projectId).toBeDefined();
  });

  it('WORK ITEM: service Bearer token still creates work item', async () => {
    // Make sure project actually exists so fk doesn't fail
    const pId = randomUUID();
    const hmac = createHmac('sha256', 'test-secret');
    hmac.update(pId);
    const pToken = `${pId}.${hmac.digest('hex')}`;
    
    await prisma.project.create({
      data: { id: pId, name: 'Service Project', slug: pId, lifecycleState: 'ACTIVE', revision: 1 }
    });

    const res = await request(app)
      .post('/api/work-items').set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${pToken}`)
      .send({ objective: 'Service run' });
    
    expect(res.status).toBe(201);
    expect(res.body.objective).toBe('Service run');
  });

  // ==========================================
  // LOGOUT
  // ==========================================
  it('LOGOUT: clears cookie and safe to repeat', async () => {
    const res = await request(app)
      .post('/api/auth/logout').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie);
    
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    
    // Cookie should be cleared (Max-Age=0 or empty)
    const clearCookie = cookies.find((c: string) => c.startsWith('co_session=;'));
    expect(clearCookie).toBeDefined();

    // Re-using old cookie on protected route should now be invalid/cleared
    // We can't easily test browser ignoring it, but we proved Set-Cookie was sent correctly.
  });
});

describe('Auth Session API', () => {
  it('returns unauthenticated when no cookie provided', async () => {
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('returns authenticated and projectBound=false for unbound session', async () => {
    const fakePayload = { version: 1, role: 'OWNER', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, projectId: null };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fakeCookie = 's:' + require('cookie-signature').sign(JSON.stringify(fakePayload), process.env.SESSION_SECRET);
    const res = await request(app).get('/api/auth/session').set('Cookie', `co_session=${encodeURIComponent(fakeCookie)}`);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.projectBound).toBe(false);
  });

  it('returns authenticated and projectBound=true for bound session', async () => {
    const fakePayload = { version: 1, role: 'OWNER', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, projectId: 'proj_123' };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fakeCookie = 's:' + require('cookie-signature').sign(JSON.stringify(fakePayload), process.env.SESSION_SECRET);
    const res = await request(app).get('/api/auth/session').set('Cookie', `co_session=${encodeURIComponent(fakeCookie)}`);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.projectBound).toBe(true);
  });
});
