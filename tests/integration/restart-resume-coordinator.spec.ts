import { TrustedOwnerAuthorityIssuer } from '@co/policy';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaEventLedger } from '@co/persistence';
import { RunCoordinator } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle, StructuredReviewer } from '@co/contracts';

const poolA = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orchestrator' });
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

  it('persists events, destroys in-memory state, and reconstructs to resume with post-approval dispatch', async () => {
    const projectId = randomUUID();
    const workflowRunId = randomUUID();
    const correlationId = randomUUID();

    await prismaA.project.create({
      data: {
        id: projectId,
        slug: `test-proj-${projectId.slice(0, 8)}`,
        name: 'Test Project'
      }
    });

    const ledgerA = new PrismaEventLedger(prismaA);

    let bridgeCallCount = 0;
    const bridgeA: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockImplementation(async () => {
        bridgeCallCount++;
        return {
          schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
          summary: 'A', actionsTaken: [], artifacts: [], findings: [], evidence: [],
          unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
        } as AgentRunResult;
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const reviewerA: StructuredReviewer = {
reviewExecution: vi.fn().mockResolvedValue({ decision: 'OWNER_DECISION_REQUIRED', findings: ['Needs owner'], pendingAction: 'generic_action', pendingGate: 'gate-1', pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED', evidenceRefs: [] })
    };

    // canonicalTaskId is distinct from BOTH workflowRunId and workItemId — proving no fallback occurs
    const canonicalTaskId = 'task-canonical-1';

    const coordinatorA = new RunCoordinator(bridgeA, ledgerA, reviewerA, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId,
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do something',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    await coordinatorA.execute(wp, workflowRunId, correlationId, projectId);

    expect(bridgeCallCount).toBe(1);

    const eventsA = await prismaA.projectEvent.findMany({ where: { aggregateId: workflowRunId } });
    console.log("EVENTS_A", eventsA.map(e => e.eventType));
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsA.some(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED')).toBe(true);
    expect(eventsA.some(e => e.eventType === 'RUN_CLOSED')).toBe(false);

    await prismaA.$disconnect();

    // Secondary coordinator
    const poolB = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orchestrator' });
    const adapterB = new PrismaPg(poolB);
    const prismaB = new PrismaClient({ adapter: adapterB });
    const ledgerB = new PrismaEventLedger(prismaB);

    let bridgeBDispatchCount = 0;
    const bridgeB: AgentBridge = {
      dispatch: vi.fn().mockImplementation(async () => {
        bridgeBDispatchCount++;
        return { runId: 'r2', status: 'RUNNING' } as AgentRunHandle;
      }),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0', runRef: { runId: 'r2' }, status: 'COMPLETED',
        summary: 'B', actionsTaken: [], artifacts: [], findings: [], evidence: [],
        unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      } as AgentRunResult),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const reviewerB: StructuredReviewer = {
reviewExecution: vi.fn().mockResolvedValue({ decision: 'COMPLETE', findings: [], evidenceRefs: [] })
    };

    // coordinatorB uses the SAME canonicalTaskId — distinct from workflowRunId AND workItemId
    const coordinatorB = new RunCoordinator(bridgeB, ledgerB, reviewerB, 'task-canonical-1', { timeoutMs: 50, intervalMs: 10 });

    // Issuer is bound to the canonical task ID ('task-canonical-1'), NOT workflowRunId or workItemId
    const issuer = new TrustedOwnerAuthorityIssuer('owner-1', 'task-canonical-1');
    const ownerEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED', boundToAction: 'generic_action', boundToGate: 'gate-1' });

    await coordinatorB.resumeWithAuthority(workflowRunId, ownerEvent);

    expect(bridgeBDispatchCount).toBe(1);

    const eventsB = await prismaB.projectEvent.findMany({ where: { aggregateId: workflowRunId } });
    expect(eventsB.some(e => e.eventType === 'RUN_RESUMED')).toBe(true);
    expect(eventsB.some(e => e.eventType === 'RUN_STARTED')).toBe(true);
    expect(eventsB.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);

    await prismaB.$disconnect();
  });
});
