import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, tryExpireApproval } from '../../apps/api/src/index';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHmac } from 'crypto';
const SECRET = 'test-secret';
process.env.API_SERVICE_TOKEN = SECRET;

function generateToken(projId) {
  const hmac = createHmac('sha256', SECRET);
  hmac.update(projId);
  return `${projId}.${hmac.digest('hex')}`;
}


import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ApprovalConsumeDto } from '@co/contracts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let projectId: string;
let workItemId: string;

describe('P6 — Approval Authority Subsystem', () => {

  it('concurrent approve-vs-reject test', async () => {
    const scope = { kind: 'COMMIT', paths: ['race_decide.ts'], message: 'race' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    
    // Fire approve and reject concurrently
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' }),
      request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'REJECTED' })
    ]);
    
    // One must succeed (200), one must fail with 409
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
    
    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    const decisionEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: { in: ['APPROVED', 'REJECTED'] } } });
    
    expect(decisionEvents).toBe(1);
    expect(dbApproval?.status === 'APPROVED' || dbApproval?.status === 'REJECTED').toBe(true);
  });

  it('duplicate decision test', async () => {
    const scope = { kind: 'COMMIT', paths: ['dup_decide.ts'], message: 'dup' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    
    // Fire approve twice concurrently
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' }),
      request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' })
    ]);
    
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
    
    const decisionEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: 'APPROVED' } });
    expect(decisionEvents).toBe(1);
  });


  it('expire vs consume race test', async () => {
    const scopeA = { kind: 'COMMIT', paths: ['raceA.ts'], message: 'A' };
    const createResA = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: scopeA, evidenceRefs: [], requestedBy: 'SYSTEM', expiresAt: new Date(Date.now() + 100000).toISOString() });
    const approvalIdA = createResA.body.id;
    await prisma.approval.update({ where: { id: approvalIdA }, data: { status: 'APPROVED' } });
    
    const dbApprovalBefore = await prisma.approval.findUnique({ where: { id: approvalIdA } });

    // Race the HTTP consume endpoint against the real shared transition service used in production for expiry
    const consumePromise = request(app).post(`/api/approvals/${approvalIdA}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ gateKind: 'COMMIT', scope: scopeA as unknown as never });
    const expirePromise = prisma.$transaction(tx => tryExpireApproval(tx, dbApprovalBefore));
    
    const [consumeResA] = await Promise.all([consumePromise, expirePromise]);
    
    const dbApprovalA = await prisma.approval.findUnique({ where: { id: approvalIdA } });
    expect(dbApprovalA?.status === 'USED' || dbApprovalA?.status === 'EXPIRED').toBe(true);
    
    const usedEvents = await prisma.approvalAuditEvent.count({ where: { approvalId: approvalIdA, eventType: 'USED' } });
    const expiredEvents = await prisma.approvalAuditEvent.count({ where: { approvalId: approvalIdA, eventType: 'EXPIRED' } });
    
    // Exactly one terminal state, exactly one audit event matching that state
    if (dbApprovalA?.status === 'USED') {
      expect(consumeResA.status).toBe(200);
      expect(usedEvents).toBe(1);
      expect(expiredEvents).toBe(0);
    } else {
      expect(consumeResA.status).toBe(409);
      expect(usedEvents).toBe(0);
      expect(expiredEvents).toBe(1);
    }
  });

  it('double expiry test: two concurrent expired consume attempts', async () => {
    const scope = { kind: 'COMMIT', paths: ['double_exp.ts'], message: 'exp' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM', expiresAt: new Date(Date.now() - 1000).toISOString() });
    const approvalId = createRes.body.id;
    await prisma.approval.update({ where: { id: approvalId }, data: { status: 'APPROVED' } });
    
    const payload = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(payload),
      request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(payload)
    ]);
    
    expect(res1.status).toBe(409);
    expect(res2.status).toBe(409);
    
    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(dbApproval?.status).toBe('EXPIRED');
    
    const expiredEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: 'EXPIRED' } });
    expect(expiredEvents).toBe(1);
    
    const usedEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: 'USED' } });
    expect(usedEvents).toBe(0);
  });

  it('decide endpoint equality-boundary test', async () => {
    const exactTime = new Date('2026-09-01T12:00:00.000Z');
    const scope = { kind: 'COMMIT', paths: ['decide.ts'], message: 'decide boundary' };
    
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ 
      projectId, 
      gateKind: 'COMMIT', 
      scope, 
      evidenceRefs: [], 
      requestedBy: 'SYSTEM', 
      expiresAt: exactTime.toISOString() 
    });
    
    const approvalId = createRes.body.id;
    
    vi.useFakeTimers();
    vi.setSystemTime(exactTime);
    
    const decideRes = await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });
    
    vi.useRealTimers();
    
    expect(decideRes.status).toBe(409);
    expect(decideRes.body.code).toBe('APPROVAL_EXPIRED');

    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(dbApproval?.status).toBe('EXPIRED');
  });


  it('expiry boundary test: approval expired if expiresAt is exactly decisionTime', async () => {
    const exactTime = new Date('2026-09-01T12:00:00.000Z');
    const scope = { kind: 'COMMIT', paths: ['boundary.ts'], message: 'boundary test' };
    
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ 
      projectId, 
      gateKind: 'COMMIT', 
      scope, 
      evidenceRefs: [], 
      requestedBy: 'SYSTEM', 
      expiresAt: exactTime.toISOString() 
    });
    
    const approvalId = createRes.body.id;
    await prisma.approval.update({ where: { id: approvalId }, data: { status: 'APPROVED' } });
    
    vi.useFakeTimers();
    vi.setSystemTime(exactTime);
    
    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    
    vi.useRealTimers();
    
    expect(consumeRes.status).toBe(409);
    expect(consumeRes.body.code).toBe('APPROVAL_EXPIRED');

    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(dbApproval?.status).toBe('EXPIRED');
    
    const usedEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: 'USED' } });
    expect(usedEvents).toBe(0);
    
    const expiredEvents = await prisma.approvalAuditEvent.count({ where: { approvalId, eventType: 'EXPIRED' } });
    expect(expiredEvents).toBe(1);
  });


  it('expiry race test: approval expired at transaction decision time', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const scope = { kind: 'COMMIT', paths: ['test.ts'], message: 'expired race test' };
    
    // Create an approval that is APPROVED but expires in the past
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM', expiresAt: pastDate });
    const approvalId = createRes.body.id;
    await prisma.approval.update({ where: { id: approvalId }, data: { status: 'APPROVED' } });
    
    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    
    expect(consumeRes.status).toBe(409);
    expect(consumeRes.body.code).toBe('APPROVAL_EXPIRED');

    // Final state must be EXPIRED
    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(dbApproval?.status).toBe('EXPIRED');
    
    // Event counts
    const usedEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId, eventType: 'USED' } });
    expect(usedEvents.length).toBe(0);

    const expiredEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId, eventType: 'EXPIRED' } });
    expect(expiredEvents.length).toBe(1);
  });


  it('same semantic scope with different JSON key order is accepted', async () => {
    const scopeCreate = { kind: 'PUSH', commitSha: 'abc', remote: 'origin', branch: 'main' };
    const scopeConsume = { branch: 'main', commitSha: 'abc', kind: 'PUSH', remote: 'origin' };
    
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'PUSH', scope: scopeCreate, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ gateKind: 'PUSH', scope: scopeConsume as unknown as never });
    expect(consumeRes.status).toBe(200);
  });

  it('same COMMIT paths in different order is accepted', async () => {
    const scopeCreate = { kind: 'COMMIT', paths: ['b.ts', 'a.ts', 'c.ts'], message: 'm' };
    const scopeConsume = { kind: 'COMMIT', paths: ['c.ts', 'a.ts', 'b.ts'], message: 'm' };
    
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: scopeCreate, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ gateKind: 'COMMIT', scope: scopeConsume as unknown as never });
    expect(consumeRes.status).toBe(200);
  });

  it('different path set yields APPROVAL_SCOPE_MISMATCH', async () => {
    const scopeCreate = { kind: 'COMMIT', paths: ['a.ts', 'b.ts'], message: 'm' };
    const scopeConsume = { kind: 'COMMIT', paths: ['a.ts'], message: 'm' };
    
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: scopeCreate, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ gateKind: 'COMMIT', scope: scopeConsume as unknown as never });
    expect(consumeRes.status).toBe(400);
    expect(consumeRes.body.code).toBe('APPROVAL_SCOPE_MISMATCH');
  });

  it('invalid gate scope combinations are rejected', async () => {
    // gateKind=COMMIT but scope.kind=PUSH
    let res = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: { kind: 'PUSH', commitSha: '123', remote: 'origin', branch: 'main' }, evidenceRefs: [], requestedBy: 'SYSTEM' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_GATE_SCOPE_COMBINATION');

    // MISSING_COMMIT_PATHS_REJECTED
    res = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: { kind: 'COMMIT', message: 'msg' }, evidenceRefs: [], requestedBy: 'SYSTEM' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_GATE_SCOPE_COMBINATION');

    // MISSING_PUSH_SHA_REJECTED
    res = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'PUSH', scope: { kind: 'PUSH', remote: 'origin', branch: 'main' }, evidenceRefs: [], requestedBy: 'SYSTEM' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_GATE_SCOPE_COMBINATION');
  });

  beforeAll(async () => {
    await prisma.approvalAuditEvent.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.workItem.deleteMany();
    await prisma.project.deleteMany();

    const proj = await prisma.project.create({
      data: { id: randomUUID(), slug: 'p6-test', name: 'P6 Test Project', lifecycleState: 'ACTIVE', revision: 1 },
    });
    projectId = proj.id;

    const wi = await prisma.workItem.create({
      data: { id: randomUUID(), projectId: proj.id, type: 'FEATURE', objective: 'Test P6 approval flow', lifecycleState: 'REVIEW_REQUIRED', revision: 1 },
    });
    workItemId = wi.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('COMMIT and PUSH gateKinds are independent approval records', async () => {
    const commitRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, workItemId, gateKind: 'COMMIT', scope: { kind: 'COMMIT', paths: ['apps/api/src/index.ts'], message: 'feat: test' }, evidenceRefs: [{ id: randomUUID(), claim: 'Tests pass', sourceRef: 'ci/123' }], requestedBy: 'SYSTEM' });
    expect(commitRes.status).toBe(201);
    expect(commitRes.body.gateKind).toBe('COMMIT');

    const pushRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, workItemId, gateKind: 'PUSH', scope: { kind: 'PUSH', commitSha: 'abc123', remote: 'origin', branch: 'main' }, evidenceRefs: [], requestedBy: 'SYSTEM' });
    expect(pushRes.status).toBe(201);
    expect(pushRes.body.gateKind).toBe('PUSH');

    expect(commitRes.body.id).not.toBe(pushRes.body.id);
  });

  it('approval scope is persisted exactly and returned in full', async () => {
    const exactScope = { kind: 'COMMIT', paths: ['apps/worker/src/worker.ts', 'apps/worker/package.json'], message: 'feat(worker): genuine runtime', candidateSha: 'deadbeef' };
    const res = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: exactScope, evidenceRefs: [{ id: randomUUID(), claim: 'Reviewer PASS', sourceRef: 'rev/456' }], requestedBy: 'ANTIGRAVITY' });
    expect(res.status).toBe(201);
    expect(res.body.scope).toMatchObject(exactScope);
  });

  it('single-use: approval can only be consumed once', async () => {
    const scope = { kind: 'COMMIT', paths: ['apps/api/src/index.ts'], message: 'test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;

    const decideRes = await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED', rationale: 'All criteria met', decidedBy: 'OWNER' });
    expect(decideRes.status).toBe(200);

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    expect(consumeRes.status).toBe(200);
    expect(consumeRes.body.status).toBe('USED');
    expect(consumeRes.body.consumedAt).toBeTruthy();

    const replayRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    expect(replayRes.status).toBe(409);
    expect(replayRes.body.code).toBe('APPROVAL_NOT_APPROVED');
  });

  it('wrong scope rejected', async () => {
    const scope = { kind: 'COMMIT', paths: ['foo.ts'], message: 'test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;

    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: { kind: 'COMMIT', paths: ['bar.ts'], message: 'test' } as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    
    expect(consumeRes.status).toBe(400);
    expect(consumeRes.body.code).toBe('APPROVAL_SCOPE_MISMATCH');
  });

  it('wrong gate kind rejected', async () => {
    const scope = { kind: 'COMMIT', paths: ['foo.ts'], message: 'test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;

    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumePayload: ApprovalConsumeDto = { gateKind: 'PUSH', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    
    expect(consumeRes.status).toBe(400);
    expect(consumeRes.body.code).toBe('APPROVAL_GATE_KIND_MISMATCH');
  });

  it('concurrent double consume test: exactly one succeeds, one conflict, one used event', async () => {
    const scope = { kind: 'COMMIT', paths: ['concurrent.ts'], message: 'test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;

    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    
    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload),
      request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload)
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409); // One must hit concurrency conflict or NOT_APPROVED

    const finalApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(finalApproval?.status).toBe('USED');

    const auditEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId, eventType: 'USED' } });
    expect(auditEvents.length).toBe(1); // EXACTLY ONE USED EVENT
  });

  it('rejected approval cannot be consumed', async () => {
    const scope = { kind: 'PUSH', commitSha: 'abc', remote: 'origin', branch: 'main' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'PUSH', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'REJECTED' });

    const consumePayload: ApprovalConsumeDto = { gateKind: 'PUSH', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    expect(consumeRes.status).toBe(409);
    expect(consumeRes.body.code).toBe('APPROVAL_NOT_APPROVED');
  });

  it('expired approval cannot be consumed and correctly persists EXPIRED state (no rollback)', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const scope = { kind: 'COMMIT', paths: ['test.ts'], message: 'expired test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM', expiresAt: pastDate });
    const approvalId = createRes.body.id;

    // Direct DB mutation to simulate being approved then expiring
    await prisma.approval.update({ where: { id: approvalId }, data: { status: 'APPROVED' } });

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    expect(consumeRes.status).toBe(409);
    expect(consumeRes.body.code).toBe('APPROVAL_EXPIRED');

    const dbApproval = await prisma.approval.findUnique({ where: { id: approvalId } });
    expect(dbApproval?.status).toBe('EXPIRED');
    
    // Ensure audit event is present
    const auditEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId, eventType: 'EXPIRED' } });
    expect(auditEvents.length).toBe(1);
  });

  it('approval lifecycle transitions PENDING→APPROVED→USED are tracked', async () => {
    const scope = { kind: 'COMMIT', paths: ['readme.md'], message: 'lifecycle test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;
    expect(createRes.body.status).toBe('PENDING');

    const approveRes = await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED', decidedBy: 'OWNER' });
    expect(approveRes.body.status).toBe('APPROVED');

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    const consumeRes = await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);
    expect(consumeRes.body.status).toBe('USED');

    const auditEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId } });
    const eventTypes = auditEvents.map(e => e.eventType);
    expect(eventTypes).toContain('REQUESTED');
    expect(eventTypes).toContain('APPROVED');
    expect(eventTypes).toContain('USED');
  });

  it('evidence refs are stored and returned exactly', async () => {
    const evidenceRefs = [{ id: randomUUID(), claim: 'CI tests PASS', sourceRef: 'ci/build/999' }];
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope: { kind: 'COMMIT', paths: ['x.ts'], message: 'evidence test' }, evidenceRefs, requestedBy: 'SYSTEM' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.evidenceRefs).toHaveLength(1);
    expect(createRes.body.evidenceRefs[0].claim).toBe('CI tests PASS');
  });

  it('post-action verification can be attached to USED approval', async () => {
    const scope = { kind: 'COMMIT', paths: ['z.ts'], message: 'pav test' };
    const createRes = await request(app).post('/api/approvals').set('Authorization', `Bearer ${generateToken(projectId)}`).send({ projectId, gateKind: 'COMMIT', scope, evidenceRefs: [], requestedBy: 'SYSTEM' });
    const approvalId = createRes.body.id;

    await request(app).post(`/api/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ decision: 'APPROVED' });
    
    // verify rejected before USED
    const earlyVerify = await request(app).post(`/api/approvals/${approvalId}/verify`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ result: 'PASS', verifiedAt: new Date().toISOString() });
    expect(earlyVerify.status).toBe(409);

    const consumePayload: ApprovalConsumeDto = { gateKind: 'COMMIT', scope: scope as unknown as never };
    await request(app).post(`/api/approvals/${approvalId}/consume`).set('Authorization', `Bearer ${generateToken(projectId)}`).send(consumePayload);

    const verifyRes = await request(app).post(`/api/approvals/${approvalId}/verify`).set('Authorization', `Bearer ${generateToken(projectId)}`).send({ result: 'PASS', verifiedAt: new Date().toISOString(), sha: 'deadbeef', details: 'Commit verified' });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.postActionVerification.result).toBe('PASS');

    const auditEvents = await prisma.approvalAuditEvent.findMany({ where: { approvalId } });
    expect(auditEvents.map(e => e.eventType)).toContain('POST_ACTION_VERIFIED');
  });
});
