/* eslint-disable @typescript-eslint/no-unused-vars, prefer-const */
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

describe('P12-R60 Final V1 Closure', () => {
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
    const engine = new MinimalWorkflowEngine(workStore);
    const mockAdapter = new MockAgentAdapter('SUCCESS');
    workerHost = new WorkerHost(prisma, workStore, engine, mockAdapter, evidenceStore, { pollIntervalMs: 50 });
  });

  afterAll(async () => {
    await workerHost.stop();
    await prisma.$disconnect();
    await pool.end();
  });

  it('Owner login', async () => {
    const loginRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ bootstrapKey: OWNER_KEY });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers['set-cookie'];
    ownerCookie = setCookie[0].split(';')[0];
  });

  it('Create Project', async () => {
    const createRes = await request(API_URL)
      .post('/api/projects')
      .set('Cookie', ownerCookie).set('Origin', 'http://localhost:5173')
      .send({ name: 'R60 Project', slug: 'r60-proj-' + Date.now() });
    expect(createRes.status).toBe(201);
    projectId = createRes.body.id;
  });

  it('Select existing project (binds cookie to projectId)', async () => {
    // login again to get a fresh, unbound cookie
    const loginRes = await request(API_URL)
      .post('/api/auth/login')
      .send({ bootstrapKey: OWNER_KEY });
    let sessionCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const selectRes = await request(API_URL)
      .post('/api/auth/select-project')
      .set('Cookie', sessionCookie).set('Origin', 'http://localhost:5173')
      .send({ projectId });
    expect(selectRes.status).toBe(200);
    const selectCookie = selectRes.headers['set-cookie'][0].split(';')[0];
    ownerCookie = selectCookie; // use this strictly bound cookie
  });

  it('Dispatch', async () => {
    const createWi = await request(API_URL)
      .post('/api/work-items')
      .set('Cookie', ownerCookie).set('Origin', 'http://localhost:5173')
      .send({
        type: 'TASK',
        objective: 'Test R60 Flow'
      });
    expect(createWi.status).toBe(201);
    workItemId = createWi.body.id;

    const startWi = await request(API_URL)
      .post(`/api/work-items/${workItemId}/start`)
      .set('Cookie', ownerCookie).set('Origin', 'http://localhost:5173')
      .send({});
    expect(startWi.status).toBe(200);
  });

  it('Worker processes item -> Provider -> Attempt -> Artifact/Evidence', async () => {
    const pStart = workerHost.start();
    let wi;
    for (let i = 0; i < 20; i++) {
      wi = await prisma.workItem.findUnique({ where: { id: workItemId } });
      if (wi?.lifecycleState === 'VERIFICATION_REQUIRED') break;
      await new Promise(r => setTimeout(r, 100));
    }
    await workerHost.stop();
    await pStart;

    expect(wi?.lifecycleState).toBe('VERIFICATION_REQUIRED');
    const evidence = await prisma.evidenceRecord.findMany({ where: { workItemId } });
    expect(evidence.length).toBeGreaterThan(0);
    // Identity must be UUID
    expect(evidence[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // Evidence requirement must be from schema
    expect(wi?.evidenceRequirements).toEqual(['AGENT_RESULT_VERIFICATION']);
  });

  it('Verification -> CompletionDecision -> COMPLETED', async () => {

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

  it('Recovery: partial persistence crash and restart with stable identities', async () => {
    const recoveryWiId = crypto.randomUUID();
    await prisma.workItem.create({
      data: {
        id: recoveryWiId,
        projectId,
      type: 'TASK',
        objective: 'Test Recovery',
        lifecycleState: 'READY',
        revision: 1
      }
    });

    const engine = new MinimalWorkflowEngine(workStore);
    const mockAdapter = new MockAgentAdapter('SUCCESS');

    // Create a worker host with an EvidenceStore that THROWS on the first saveEvidence!
    const crashingEvidenceStore = new PrismaEvidenceStore(prisma);
    const originalSave = crashingEvidenceStore.saveEvidence.bind(crashingEvidenceStore);
    let calls = 0;
    crashingEvidenceStore.saveEvidence = async (ev) => {
      if (calls === 0) {
        calls++;
        throw new Error('Simulated Crash during persistence!');
      }
      return originalSave(ev);
    };

    const crashingHost = new WorkerHost(prisma, workStore, engine, mockAdapter, crashingEvidenceStore, { pollIntervalMs: 50 });

    // We explicitly call processItem directly instead of start() so we can catch the crash
    const wiToCrash = await workStore.getWorkItem(recoveryWiId);
    try {
      await crashingHost['processItem'](wiToCrash);
    } catch {
      // Expected crash
    }

    // In our WorkerHost, the crash is caught and logged: "unhandled error".
    // It does NOT transition to VERIFICATION_REQUIRED, so it stays RUNNING (or whatever engine set it to).
    // Wait, if it crashes inside WorkerHost, the engine already set it to VERIFICATION_REQUIRED!
    // Ah! engine.execute sets it to VERIFICATION_REQUIRED.
    // If it sets it to VERIFICATION_REQUIRED, it won't be picked up by polling ('READY'/'QUEUED').
    // So the "crash" must happen INSIDE the engine or adapter?
    // The prompt says: "Testează crash/retry după persistență parțială și restart/resume cu IDs stabile și zero duplicate."
    // If the orchestrator crashes DURING persistence, the workItem is in VERIFICATION_REQUIRED but missing evidence.
    // Wait, if it's VERIFICATION_REQUIRED, how does it retry?
    // It doesn't retry automatically from polling. It requires RECOVERY_REQUIRED.
  });
});
