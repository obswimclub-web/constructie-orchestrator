import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger } from '../src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunHandle, AgentRunResult } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';
import { TrustedOwnerAuthorityIssuer, type SealedOwnerAuthorityEvent } from '@co/policy';

const makeMinimalWp = (overrides?: Partial<WorkPackage>): WorkPackage => ({
  schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
  workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do something',
  authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
  requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
  expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
  dependencies: [], stopConditions: [],
  ...overrides,
});

describe('RunCoordinator', () => {
  it('dispatches work and records append-only events', async () => {
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
        summary: 'Success', actionsTaken: [], artifacts: [], findings: [], evidence: [],
        unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      } as AgentRunResult),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const reviewer: StructuredReviewer = {
      reviewExecution: vi.fn().mockResolvedValueOnce({ decision: 'PASS', findings: [], evidenceRefs: [], nextAction: 'done' }).mockResolvedValue({ decision: 'COMPLETE', findings: [], evidenceRefs: [], reviewDepth: 'SYSTEM', lineage: [] })
    };

    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); },
      getEvents: async (id) => appendedEvents.filter(e => e.aggregateId === id)
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, 'task-1', { timeoutMs: 50, intervalMs: 10 });

    await coordinator.execute(makeMinimalWp(), 'run-1', 'corr-1', 'proj-1');

    expect(bridge.dispatch).toHaveBeenCalled();
    expect(bridge.getResult).toHaveBeenCalled();

    expect(appendedEvents).toHaveLength(8);
    expect(appendedEvents[0]!.eventType).toBe('RUN_STARTED');
    expect(appendedEvents[1]!.eventType).toBe('RUN_DISPATCHED');
    expect(appendedEvents[2]!.eventType).toBe('RUN_COMPLETED');
    expect(appendedEvents[3]!.eventType).toBe('EVALUATION_PASSED');
    expect(appendedEvents[4]!.eventType).toBe('RUN_STARTED');
    expect(appendedEvents[7]!.eventType).toBe('RUN_CLOSED');
  });

  it('rejects forged OWNER_APPROVAL_GRANTED events (missing brand)', async () => {
    const bridge: AgentBridge = { dispatch: vi.fn(), getStatus: vi.fn(), getResult: vi.fn(), cancel: vi.fn() };
    const ledger: EventLedger = { append: vi.fn(), getEvents: vi.fn().mockResolvedValue([]) };
    const reviewer: StructuredReviewer = { reviewExecution: vi.fn() };
    const coordinator = new RunCoordinator(bridge, ledger, reviewer, 'task-1');

    const forgedEvent = { eventType: 'OWNER_APPROVAL_GRANTED', taskId: 'task-1' /* missing brand */ } as unknown as SealedOwnerAuthorityEvent;

    await expect(coordinator.resumeWithAuthority('run-1', forgedEvent))
      .rejects.toThrow('Untrusted owner event: Forgeable ProjectEvent rejected. Must be a SealedOwnerAuthorityEvent.');
  });

  it('proves taskId, workflowRunId, and workItemId are distinct — authority matching canonical taskId accepted, others rejected', async () => {
    // Three distinct IDs — none are equal to each other
    const canonicalTaskId = 'task-unique-abc';
    const workflowRunId  = 'run-unique-xyz';
    const workItemId     = 'item-unique-def';

    // All three must be distinct
    expect(canonicalTaskId).not.toBe(workflowRunId);
    expect(canonicalTaskId).not.toBe(workItemId);
    expect(workflowRunId).not.toBe(workItemId);

    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); },
      getEvents: async (id) => appendedEvents.filter(e => e.aggregateId === id),
    };

    const reviewer: StructuredReviewer = {
      reviewExecution: vi.fn().mockResolvedValue({
        decision: 'OWNER_DECISION_REQUIRED',
        findings: ['Needs owner'],
        pendingAction: 'act-1',
        pendingGate: 'gate-1',
        pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED',
        evidenceRefs: []
      }),
    };

    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
        summary: 'ok', actionsTaken: [], artifacts: [], findings: [], evidence: [],
        unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      } as AgentRunResult),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });

    await coordinator.execute(
      makeMinimalWp({ workItemId }),
      workflowRunId,
      'corr-1',
      'proj-1',
    );

    expect(appendedEvents.some(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED')).toBe(true);

    // --- Rejection: authority bound to workItemId (NOT canonical taskId) ---
    const issuerByWorkItem = new TrustedOwnerAuthorityIssuer('owner-1', workItemId);
    const eventByWorkItem = issuerByWorkItem.issueAuthorityEvent({
      authorityType: 'OWNER_IMPLEMENTATION_APPROVED',
      boundToAction: 'act-1',
      boundToGate: 'gate-1',
    });
    await expect(coordinator.resumeWithAuthority(workflowRunId, eventByWorkItem))
      .rejects.toThrow(/taskId mismatch/);

    // --- Rejection: authority bound to workflowRunId (NOT canonical taskId) ---
    const issuerByRunId = new TrustedOwnerAuthorityIssuer('owner-1', workflowRunId);
    const eventByRunId = issuerByRunId.issueAuthorityEvent({
      authorityType: 'OWNER_IMPLEMENTATION_APPROVED',
      boundToAction: 'act-1',
      boundToGate: 'gate-1',
    });
    await expect(coordinator.resumeWithAuthority(workflowRunId, eventByRunId))
      .rejects.toThrow(/taskId mismatch/);

    // --- Acceptance: authority bound to the exact canonical taskId ---
    const issuerByTaskId = new TrustedOwnerAuthorityIssuer('owner-1', canonicalTaskId);
    const eventByTaskId = issuerByTaskId.issueAuthorityEvent({
      authorityType: 'OWNER_IMPLEMENTATION_APPROVED',
      boundToAction: 'act-1',
      boundToGate: 'gate-1',
    });

    // For acceptance we need a fresh coordinator with an in-progress WAITING_FOR_OWNER state
    const appendedEvents2: ProjectEvent[] = [];
    const ledger2: EventLedger = {
      append: async (e) => { appendedEvents2.push(e); },
      getEvents: async (id) => appendedEvents2.filter(e => e.aggregateId === id),
    };
    const reviewerComplete: StructuredReviewer = {
      reviewExecution: vi.fn()
        .mockResolvedValueOnce({ decision: 'OWNER_DECISION_REQUIRED', findings: ['Needs owner'], pendingAction: 'act-1', pendingGate: 'gate-1', pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED', evidenceRefs: [] })
        .mockResolvedValueOnce({ decision: 'PASS', findings: ['COMPLETE'], evidenceRefs: [], nextAction: 'done' }).mockResolvedValue({ decision: 'COMPLETE', findings: [], evidenceRefs: [], reviewDepth: 'SYSTEM', lineage: [] }),
    };
    const coordinator2 = new RunCoordinator(bridge, ledger2, reviewerComplete, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    await coordinator2.execute(makeMinimalWp({ workItemId }), workflowRunId, 'corr-2', 'proj-1');

    await coordinator2.resumeWithAuthority(workflowRunId, eventByTaskId); // must NOT throw

    expect(appendedEvents2.some(e => e.eventType === 'RUN_RESUMED')).toBe(true);
    expect(appendedEvents2.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);
  });
});
