import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../apps/api/src/index';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WorkStore } from '@co/persistence';
import { MinimalWorkflowEngine } from '@co/workflow';
import { MockAgentAdapter } from '@co/agents';
import { WorkerHost } from '../../apps/worker/src/worker';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Full Worker Integration Dispatch (P12-R26)', () => {
  let projectId: string;
  let sessionCookie: string;
  let workStore: WorkStore;
  let engine: MinimalWorkflowEngine;
  let workerAdapter: MockAgentAdapter;
  let workerHost: WorkerHost;

  beforeAll(async () => {
    // Generate valid session
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ bootstrapKey: 'test-owner-key' });
    sessionCookie = res.headers['set-cookie'][0];
    
    const projRes = await request(app)
      .post('/api/projects')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({ name: 'Integration Project', slug: `dispatch-e2e-${randomUUID()}` });
    projectId = projRes.body.id;
    sessionCookie = projRes.headers['set-cookie'][0];

    workStore = new WorkStore(prisma);
    engine = new MinimalWorkflowEngine(workStore);
    workerAdapter = new MockAgentAdapter('SUCCESS');
    workerHost = new WorkerHost(prisma, workStore, engine, workerAdapter, { pollIntervalMs: 50 }); // poll every 50ms
  });

  afterAll(async () => {
    await workerHost.stop();
    await prisma.$disconnect();
    await pool.end();
  });

  it('DRAFT -> READY -> Worker execution and Attempt persistence', async () => {

    // 1. Create WorkItem -> DRAFT
    const createRes = await request(app)
      .post('/api/work-items').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({ objective: 'Dispatch E2E' });
    expect(createRes.status).toBe(201);
    const workItemId = createRes.body.id;
    expect(createRes.body.lifecycleState).toBe('DRAFT');

    // 2. Start WorkItem -> READY
    const startRes = await request(app)
      .post(`/api/work-items/${workItemId}/start`).set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send();
    expect(startRes.status).toBe(200);
    expect(startRes.body.lifecycleState).toBe('READY');

    // 3. Start worker polling
    workerHost.start();

    // 4. Wait for processing
    await new Promise(r => setTimeout(r, 500));

    // 5. Query persistence for attempts
    const attempts = await prisma.attempt.findMany({
      where: { workItemId }
    });

    expect(attempts.length).toBe(1); // Exact duplicate prevention!
    const attempt = attempts[0];
    expect(attempt.projectId).toBe(projectId);
    expect(attempt.state).toBe('SUCCEEDED'); // Terminal state from engine

    const finalItem = await prisma.workItem.findUnique({ where: { id: workItemId } });
    expect(finalItem?.lifecycleState).toBe('VERIFICATION_REQUIRED'); // Because MockAgentAdapter SUCCESS leads to VERIFICATION_REQUIRED in MinimalWorkflowEngine

    // 6. Invoke another poll / repeated /start
    const restartRes = await request(app)
      .post(`/api/work-items/${workItemId}/start`).set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send();
    expect(restartRes.status).toBe(409); // It's not DRAFT anymore! It's VERIFICATION_REQUIRED.

    // 7. Wait another poll cycle
    await new Promise(r => setTimeout(r, 200));

    // 8. Assert active semantic attempt count remains 1
    const finalAttempts = await prisma.attempt.findMany({ where: { workItemId } });
    expect(finalAttempts.length).toBe(1);

    await workerHost.stop();
  }, 10000);

  it('Negative cases: nonexistent, cross-project, terminal state', async () => {
    // nonexistent
    const neRes = await request(app)
      .post(`/api/work-items/b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0/start`).set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send();
    expect(neRes.status).toBe(404);

    // terminal state
    const createRes = await request(app)
      .post('/api/work-items').set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send({ objective: 'Terminal state test' });
    const wiId = createRes.body.id;
    
    let wi = await workStore.getWorkItem(wiId);
    wi = await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'READY' });
    wi = await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'ASSIGNED' });
    wi = await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'RUNNING' });
    await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'COMPLETED' });
    
    const terminalRes = await request(app)
      .post(`/api/work-items/${wiId}/start`).set('Origin', 'http://localhost:5173')
      .set('Cookie', sessionCookie)
      .send();
    expect(terminalRes.status).toBe(409);

    // cross-project
    const otherRes = await request(app)
      .post('/api/auth/login').send({ bootstrapKey: 'test-owner-key' });
    const otherCookie = otherRes.headers['set-cookie'][0];
    const newProj = await request(app).post('/api/projects').set('Origin', 'http://localhost:5173').set('Cookie', otherCookie).send({ name: 'Other', slug: `other-${randomUUID()}` });
    const newProjCookie = newProj.headers['set-cookie'][0];

    const crossRes = await request(app)
      .post(`/api/work-items/${wiId}/start`).set('Origin', 'http://localhost:5173')
      .set('Cookie', newProjCookie)
      .send();
    expect(crossRes.status).toBe(403);
  });



  it('Deterministic concurrency (CAS Proof): synchronized store.startAttempt executions on same READY item result in exact 1 Attempt', async () => {
    const createRes = await request(app).post('/api/work-items').set('Origin', 'http://localhost:5173').set('Cookie', sessionCookie).send({ objective: 'CAS Proof' });
    const wiId = createRes.body.id;
    let wi = await workStore.getWorkItem(wiId);
    wi = await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'READY' });

    // We invoke workStore.startAttempt directly to prove the transactional CAS rollback
    const attemptBase = {
      id: randomUUID(),
      projectId: wi.projectId,
      workItemId: wi.id,
      attemptNumber: 1,
      state: 'NOT_STARTED' as const,
      workPackageVersion: 1,
      agentRunId: 'test-run',
      agentAdapterId: 'mock-adapter',
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Create two separate attempt inputs with different IDs so we can track them
    const attempt1 = { ...attemptBase, id: randomUUID() };
    const attempt2 = { ...attemptBase, id: randomUUID() };

    // Run them perfectly concurrently
    const p1 = workStore.startAttempt({ attempt: attempt1, expectedWorkItemRevision: wi.revision });
    const p2 = workStore.startAttempt({ attempt: attempt2, expectedWorkItemRevision: wi.revision });
    
    const results = await Promise.allSettled([p1, p2]);
    
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    
    // Explicit CAS Proof: The rejected one MUST be WorkItemRevisionConflictError
    // We do NOT accept InvalidWorkItemTransitionError because they are both starting from the exact same revision.
    const reasonName = (rejected[0] as PromiseRejectedResult).reason.name;
    // We expect WorkItemRevisionConflictError or ActiveAttemptExistsError (if read-committed sees the active attempt before CAS)
    // Actually, if CAS works, it's WorkItemRevisionConflictError because the expected revision no longer matches the row.
    expect(reasonName).toBe('WorkItemRevisionConflictError');
    
    // Exact 1 Attempt in DB
    const attempts = await prisma.attempt.findMany({ where: { workItemId: wiId } });
    expect(attempts.length).toBe(1);
    
    // The successful attempt must match the one that fulfilled
    const successfulAttemptId = (fulfilled[0] as PromiseFulfilledResult<{ attempt: { id: string } }>).value.attempt.id;
    expect(attempts[0].id).toBe(successfulAttemptId);
    
    // Explicitly verify currentAttemptId wasn't mutated by the loser
    const finalWi = await prisma.workItem.findUnique({ where: { id: wiId } });
    expect(finalWi?.currentAttemptId).toBe(successfulAttemptId);
  });

  it('Stale revision: atomic rejection without mutating state', async () => {
    const createRes = await request(app).post('/api/work-items').set('Origin', 'http://localhost:5173').set('Cookie', sessionCookie).send({ objective: 'Stale' });
    const wiId = createRes.body.id;
    const wi = await workStore.getWorkItem(wiId);
    
    // First operation succeeds
    await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'READY' });
    
    // Second operation uses STALE revision
    const stalePromise = workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'ASSIGNED' });
    await expect(stalePromise).rejects.toThrow(/revision/i);

    // Verify state was not mutated by the rejected operation
    const current = await workStore.getWorkItem(wiId);
    expect(current.lifecycleState).toBe('READY'); // Not ASSIGNED
    expect(current.revision).toBe(wi.revision + 1); // Only mutated by first operation
  });


  it('Engine concurrency: synchronized MinimalWorkflowEngine executions on same READY item result in exact 1 Attempt and 1 Adapter call', async () => {
    const createRes = await request(app).post('/api/work-items').set('Origin', 'http://localhost:5173').set('Cookie', sessionCookie).send({ objective: 'Engine Concurrency' });
    const wiId = createRes.body.id;
    let wi = await workStore.getWorkItem(wiId);
    wi = await workStore.transitionWorkItem({ workItemId: wiId, expectedRevision: wi.revision, to: 'READY' });

    let adapterExecutions = 0;
    class CountingMockAdapter extends MockAgentAdapter {
      async execute(...args: Parameters<MockAgentAdapter['execute']>) {
        adapterExecutions++;
        return super.execute(args[0], args[1]);
      }
    }
    
    const countAdapter = new CountingMockAdapter('SUCCESS');
    const syncEngine = new MinimalWorkflowEngine(workStore);
    
    const dummyWP = { id: 'wp-2', workPackageId: 'wp-2', revision: 1, version: 1, projectId: wi.projectId, workItemId: wi.id, specification: { description: 'dummy' } };
    
    // Launch engine executions concurrently
    const req1 = syncEngine.execute({ workItem: wi, workPackage: dummyWP, adapter: countAdapter, workflowRunId: randomUUID(), correlationId: randomUUID() });
    const req2 = syncEngine.execute({ workItem: wi, workPackage: dummyWP, adapter: countAdapter, workflowRunId: randomUUID(), correlationId: randomUUID() });
    
    const results = await Promise.allSettled([req1, req2]);
    
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    
    // Explicitly verify adapter calls
    expect(adapterExecutions).toBe(1);
    
    // Exactly 1 Attempt created
    const attempts = await prisma.attempt.findMany({ where: { workItemId: wiId } });
    expect(attempts.length).toBe(1);
  });

});