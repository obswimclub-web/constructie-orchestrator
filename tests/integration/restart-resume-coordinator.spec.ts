import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaEventLedger } from '@co/persistence';
import { RunCoordinator } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';

const poolA = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapterA = new PrismaPg(poolA);
const prismaA = new PrismaClient({ adapter: adapterA });

async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.projectEvent.deleteMany();
  await prisma.project.deleteMany();
}

describe('RunCoordinator Restart/Resume E2E', () => {
  beforeEach(async () => {
    await clearDatabase(prismaA);
  });

  afterAll(async () => {
    await prismaA.$disconnect();
  });

  it('persists events, destroys in-memory state, and reconstructs to resume correctly', async () => {
    const projectId = randomUUID();
    const workflowRunId = randomUUID();
    const correlationId = randomUUID();

    // Setup concrete store
    await prismaA.project.create({
      data: {
        id: projectId,
        slug: `test-proj-${projectId.slice(0, 8)}`,
        name: 'Test Project'
      }
    });

    const ledgerA = new PrismaEventLedger(prismaA);

    // Mock bridge that returns OWNER_DECISION
    let bridgeCallCount = 0;
    const bridgeA: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
      getResult: vi.fn().mockImplementation(async () => {
        bridgeCallCount++;
        return {
          schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
          summary: 'OWNER_DECISION: needs approval', actionsTaken: [], artifacts: [], findings: [], evidence: [],
          unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
        } as AgentRunResult;
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const coordinatorA = new RunCoordinator(bridgeA, ledgerA);
    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId,
      workItemId: randomUUID(), completionObjectRef: 'ref', objective: 'Do something',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    // 1. Initial run -> hits WAITING_FOR_OWNER -> writes to Prisma DB -> exits
    await coordinatorA.execute(wp, workflowRunId, correlationId, projectId);

    expect(bridgeCallCount).toBe(1);

    // Assert it's actually in DB
    const eventsA = await prismaA.projectEvent.findMany({ where: { aggregateId: workflowRunId } });
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsA.some(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED')).toBe(true);

    // 2. Destroy in-memory state
    await prismaA.$disconnect();

    // 3. Create a second coordinator instance with a new DB connection and new bridge
    const poolB = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
    const adapterB = new PrismaPg(poolB);
    const prismaB = new PrismaClient({ adapter: adapterB });
    const ledgerB = new PrismaEventLedger(prismaB);

    const bridgeB: AgentBridge = {
      dispatch: vi.fn(), getStatus: vi.fn(), getResult: vi.fn(), cancel: vi.fn()
    };
    const coordinatorB = new RunCoordinator(bridgeB, ledgerB);

    // 4. Canonical owner event arriving
    const ownerEvent = {
      id: randomUUID(),
      projectId,
      eventType: 'OWNER_APPROVAL_GRANTED',
      aggregateType: 'RUN' as const,
      aggregateId: workflowRunId,
      aggregateRevision: eventsA.length + 1,
      actorType: 'OWNER' as const,
      actorId: 'owner-1',
      correlationId,
      causationId: null,
      schemaVersion: 1,
      payload: {},
      occurredAt: new Date(),
    };

    // 5. Resume and reconstruct from DB
    await coordinatorB.resume(workflowRunId, ownerEvent);

    // 6. Assert new states were appended correctly to the ledger via Prisma
    const eventsB = await prismaB.projectEvent.findMany({ where: { aggregateId: workflowRunId } });
    expect(eventsB.length).toBeGreaterThan(eventsA.length);
    expect(eventsB.some(e => e.eventType === 'RUN_RESUMED')).toBe(true);
    expect(eventsB.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);

    await prismaB.$disconnect();
  });
});
