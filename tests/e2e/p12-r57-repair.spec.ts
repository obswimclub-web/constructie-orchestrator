import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { app } from '../../apps/api/src/index';
const API_URL = app;
const OWNER_KEY = process.env.OWNER_BOOTSTRAP_KEY || 'test-owner-key';

import { WorkerHost } from '../../apps/worker/src/worker';
import { MinimalWorkflowEngine } from '../../packages/workflow/src/minimal-workflow-engine';
import { MockAgentAdapter } from '../../packages/agents/src/mock/mock-agent-adapter';
import { PrismaEvidenceStore, WorkStore } from '../../packages/persistence/src';
import { assertVerificationCanCompleteWorkItem, computeVerificationDigest, EvidenceVerificationService } from '../../packages/evidence/src';

describe('P12-R57 Evidence & Project Binding Repair (Real E2E)', () => {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator';
  const pool = new pg.Pool({ connectionString: databaseUrl, password: 'postgres' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  let projectId: string;
  let workItemId: string;
  let ownerCookie: string;
  let workerHost: WorkerHost;
  let workStore: WorkStore;
  let evidenceStore: PrismaEvidenceStore;

  beforeAll(async () => {
    workItemId = crypto.randomUUID();
    workStore = new WorkStore(prisma);
    evidenceStore = new PrismaEvidenceStore(prisma);
  });

  afterAll(async () => {
    if (workerHost) await workerHost.stop();
    await prisma.attempt.deleteMany({ where: { workItemId } });
    await prisma.evidenceRecord.deleteMany({ where: { workItemId } });
    await prisma.artifactRecord.deleteMany({ where: { workItemId } });

    if (projectId) {
      await prisma.workItem.deleteMany({ where: { projectId } });
      await prisma.projectEvent.deleteMany({ where: { projectId } });
      await prisma.outboxEvent.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } });
    }

    await prisma.$disconnect();
  });

  it('Owner login -> legitimate project creation (native binding)', async () => {
    const loginRes = await request(API_URL)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ bootstrapKey: OWNER_KEY });
     expect(loginRes.status).toBe(200);
    const loginCookie = loginRes.headers['set-cookie'][0];

    const createRes = await request(API_URL)
      .post('/api/projects')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', loginCookie)
      .send({ name: 'Test Project', slug: `test-project-${crypto.randomUUID()}` });

    expect(createRes.status).toBe(201);
    projectId = createRes.body.id;
    ownerCookie = createRes.headers['set-cookie'][0];

    await prisma.workItem.create({
      data: {
        id: workItemId,
        projectId,
        type: 'TASK',
        objective: 'Test Evidence Persistence E2E',
        lifecycleState: 'DRAFT',
        revision: 1
      }
    });
  });

  it('cross-project denial (canonical)', async () => {
    const login2 = await request(API_URL).post('/api/auth/login').send({ bootstrapKey: OWNER_KEY });
    const cookie2 = login2.headers['set-cookie'][0];
    const create2 = await request(API_URL)
      .post('/api/projects')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', cookie2)
      .send({ name: 'Other', slug: `other-${crypto.randomUUID()}` });

    const otherCookie = create2.headers['set-cookie'][0];
    const otherProjectId = create2.body.id;

    const crossRes = await request(API_URL)
      .post(`/api/work-items/${workItemId}/start`)
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', otherCookie)
      .send({});

    expect(crossRes.status).toBe(403);

    await prisma.projectEvent.deleteMany({ where: { projectId: otherProjectId } });
    await prisma.outboxEvent.deleteMany({ where: { projectId: otherProjectId } });
    await prisma.project.delete({ where: { id: otherProjectId } });
  });

  it('allows governed dispatch after binding', async () => {
    const startRes = await request(API_URL)
      .post(`/api/work-items/${workItemId}/start`)
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ownerCookie)
      .send({});

    expect(startRes.status).toBe(200);
    expect(startRes.body.lifecycleState).toBe('READY');
  });

  it('worker processes item -> Attempt -> Artifact/Evidence -> VERIFICATION_REQUIRED', async () => {
    const engine = new MinimalWorkflowEngine(workStore);
    const mockAdapter = new MockAgentAdapter('SUCCESS');
    workerHost = new WorkerHost(prisma, workStore, engine, mockAdapter, evidenceStore, { pollIntervalMs: 50 });

    const pStart = workerHost.start();
    await new Promise(r => setTimeout(r, 800));
    await workerHost.stop();
    await pStart;

    const wi = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(wi?.lifecycleState).toBe('VERIFICATION_REQUIRED');

    const evidence = await prisma.evidenceRecord.findMany({ where: { workItemId } });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].sourceType).toBe('AGENT_RESULT');
  });



  it('duplicate delivery/idempotency does not duplicate evidence or crash', async () => {
    const duplicateWiId = crypto.randomUUID();
    await prisma.workItem.create({
      data: {
        id: duplicateWiId,
        projectId,
        type: 'TASK',
        objective: 'Test Duplicate Delivery',
        lifecycleState: 'READY',
        revision: 1
      }
    });

    const engine = new MinimalWorkflowEngine(workStore);
    const mockAdapter = new MockAgentAdapter('SUCCESS');
    workerHost = new WorkerHost(prisma, workStore, engine, mockAdapter, evidenceStore, { pollIntervalMs: 50000 });

    const wi = await workStore.getWorkItem(duplicateWiId);

    // Simulate exact duplicate delivery (e.g. from SQS) processed concurrently
    const p1 = workerHost['processItem'](wi);
    const p2 = workerHost['processItem'](wi);

    await Promise.all([p1, p2]);

    const updatedWi = await prisma.workItem.findUnique({ where: { id: duplicateWiId } });
    expect(updatedWi?.lifecycleState).toBe('VERIFICATION_REQUIRED');

    // Only one execution should have succeeded and saved evidence
    const evidence = await prisma.evidenceRecord.findMany({ where: { workItemId: duplicateWiId } });
    expect(evidence.length).toBe(1);
  });



  it('missing evidence fail closed: provider SUCCESS without evidence remains VERIFICATION_REQUIRED', async () => {
    const missingWiId = crypto.randomUUID();
    await prisma.workItem.create({
      data: {
        id: missingWiId,
        projectId,
        type: 'TASK',
        objective: 'Test Missing Evidence',
        lifecycleState: 'READY',
        revision: 1
      }
    });

    class NoEvidenceAdapter extends MockAgentAdapter {
      async getEvidence() { return []; }
      async getArtifacts() { return []; }
    }

    const engine = new MinimalWorkflowEngine(workStore);
    const noEvAdapter = new NoEvidenceAdapter('SUCCESS');
    workerHost = new WorkerHost(prisma, workStore, engine, noEvAdapter, evidenceStore, { pollIntervalMs: 50 });

    const pStart = workerHost.start();
    await new Promise(r => setTimeout(r, 600));
    await workerHost.stop();
    await pStart;

    const wi = await prisma.workItem.findUnique({ where: { id: missingWiId } });
    expect(wi?.lifecycleState).toBe('VERIFICATION_REQUIRED');

    const evidence = await prisma.evidenceRecord.findMany({ where: { workItemId: missingWiId } });
    expect(evidence.length).toBe(0);

    const verification: Record<string, unknown> = {
      id: crypto.randomUUID(),
      projectId,
      workItemId: missingWiId,
      status: 'PASS',
      evidenceIds: [],
      reason: 'Looks good',
      verifiedAt: new Date()
    };
    verification.digest = computeVerificationDigest(verification );

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId, workItemId: missingWiId, verification: verification , evidence
    })).toThrow('PASS verification must reference at least one EvidenceRecord');
  });

  it('legitimate verification completion', async () => {

    const evidence = await prisma.evidenceRecord.findMany({ where: { workItemId } });
    const evService = new EvidenceVerificationService(evidenceStore, workStore);

    await evService.recordVerificationAndResolve({
      workItem: await workStore.getWorkItem(workItemId),
      runId: evidence[0].runId,
      verificationType: 'MANUAL',
      status: 'PASS',
      evidenceIds: [evidence[0].id],
      verifierRef: 'owner'
    });

    const wi = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(wi?.lifecycleState).toBe('COMPLETED');
  });
});
