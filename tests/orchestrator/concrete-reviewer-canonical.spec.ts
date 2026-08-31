import { describe, it, expect, vi } from 'vitest';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import {
  RunCoordinator,
  InMemoryEventLedger,
  TrustedReconciliationIssuer,
  type StructuredReviewer,
} from '../../packages/workflow/src/run-coordinator.js';
import { TrustedOwnerAuthorityIssuer } from '@co/policy';
import type { AgentBridge, WorkPackage, AgentRunHandle, AgentRunResult } from '@co/contracts';
import { randomUUID } from 'crypto';

const makeResult = (overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  schemaVersion: '1.0.0',
  runRef: { runId: 'r1' },
  status: 'COMPLETED',
  summary: 'Done',
  actionsTaken: [],
  artifacts: [],
  findings: [],
  evidence: [],
  unresolvedItems: [],
  requestedInputs: [],
  sideEffects: [],
  usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' },
  ...overrides,
});

const makeWp = (overrides: Partial<WorkPackage> = {}): WorkPackage => ({
  schemaVersion: '1.0.0',
  workPackageId: randomUUID(),
  version: 1,
  projectId: 'proj-1',
  workItemId: 'item-1',
  completionObjectRef: 'ref',
  objective: 'Do something',
  authoritativeInputs: [],
  scope: { refs: [] },
  constraints: [],
  authorityContextRef: 'ctx',
  requiredCapabilities: [],
  allowedActions: [],
  forbiddenActions: [],
  toolsAllowed: [],
  expectedArtifactsOut: [],
  verificationRequirements: [],
  evidenceRequirements: [],
  dependencies: [],
  stopConditions: [],
  ...overrides,
});

// ─── ConcreteStructuredReviewer unit tests ────────────────────────────────────

describe('ConcreteStructuredReviewer', () => {
  const reviewer = new ConcreteStructuredReviewer();

  it('COMPLETED with no requestedInputs → COMPLETE (run closes, not PASS without nextAction)', async () => {
    const result = makeResult({ status: 'COMPLETED', requestedInputs: [] });
    const decision = await reviewer.reviewExecution(result);
    expect(decision.decision).toBe('COMPLETE');
  });

  it('FAILED → FAIL_REPAIRABLE with feedback', async () => {
    const result = makeResult({ status: 'FAILED', summary: 'Build error' });
    const decision = await reviewer.reviewExecution(result);
    expect(decision.decision).toBe('FAIL_REPAIRABLE');
    expect(decision.findings[0]).toBe('Build error');
  });

  it('CANCELLED → AMBIGUOUS_SIDE_EFFECT', async () => {
    const result = makeResult({ status: 'CANCELLED' });
    const decision = await reviewer.reviewExecution(result);
    expect(decision.decision).toBe('AMBIGUOUS_SIDE_EFFECT');
  });

  it('INTERRUPTED → AMBIGUOUS_SIDE_EFFECT', async () => {
    const result = makeResult({ status: 'INTERRUPTED' });
    const decision = await reviewer.reviewExecution(result);
    expect(decision.decision).toBe('AMBIGUOUS_SIDE_EFFECT');
  });

  it('COMPLETED with requestedInputs → OWNER_DECISION_REQUIRED with full bindings', async () => {
    const result = makeResult({
      status: 'COMPLETED',
      requestedInputs: [{ key: 'secret', description: 'Need API key', required: true }],
    });
    const decision = await reviewer.reviewExecution(result);
    expect(decision.decision).toBe('OWNER_DECISION_REQUIRED');
    // All three bindings must be present and non-empty
    expect(decision.pendingAction).toBeTruthy();
    expect(decision.pendingGate).toBeTruthy();
    expect(decision.pendingAuthorityType).toBeTruthy();
  });
});

// ─── Canonical runtime path: ConcreteStructuredReviewer + RunCoordinator ─────

describe('Canonical runtime path (ConcreteStructuredReviewer + RunCoordinator)', () => {
  const canonicalTaskId = 'task-canon-test';

  it('ordinary COMPLETED result closes the run cleanly (no throw on PASS without nextAction)', async () => {
    const ledger = new InMemoryEventLedger();
    const reviewer = new ConcreteStructuredReviewer();

    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue(makeResult({ status: 'COMPLETED', requestedInputs: [] })),
      cancel: vi.fn(),
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    const wp = makeWp({ workItemId: 'item-1' });

    // Must not throw
    await expect(coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1')).resolves.toBeUndefined();

    const events = await ledger.getEvents('run-1');
    expect(events.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);
    expect(events.some(e => e.eventType === 'RUN_BLOCKED')).toBe(false);
  });

  it('requestedInputs result pauses with fully bound action/gate/authorityType and resumes with canonical authority', async () => {
    const ledger = new InMemoryEventLedger();
    const reviewer = new ConcreteStructuredReviewer();

    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn()
        // First call: pauses for owner input
        .mockResolvedValueOnce(makeResult({
          status: 'COMPLETED',
          requestedInputs: [{ key: 'token', description: 'API token', required: true }],
        }))
        // Second call: terminal
        .mockResolvedValueOnce(makeResult({ status: 'COMPLETED', requestedInputs: [] })),
      cancel: vi.fn(),
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    const wp = makeWp({ workItemId: 'item-1' });

    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    const events = await ledger.getEvents('run-1');
    const pauseEvent = events.find(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED');
    expect(pauseEvent).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = pauseEvent!.payload as any;
    // All three bindings must be present
    expect(payload.pendingAction).toBeTruthy();
    expect(payload.pendingGate).toBeTruthy();
    expect(payload.pendingAuthorityType).toBeTruthy();

    // Resume with authority bound to EXACTLY the canonical taskId + all three bindings
    const issuer = new TrustedOwnerAuthorityIssuer('owner-1', canonicalTaskId);
    const authority = issuer.issueAuthorityEvent({
      authorityType: payload.pendingAuthorityType,
      boundToAction: payload.pendingAction,
      boundToGate: payload.pendingGate,
    });

    // Must not throw and must close the run
    await expect(coordinator.resumeWithAuthority('run-1', authority)).resolves.toBeUndefined();

    const eventsAfter = await ledger.getEvents('run-1');
    expect(eventsAfter.some(e => e.eventType === 'RUN_RESUMED')).toBe(true);
    expect(eventsAfter.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);
  });
});

// ─── SealedReconciliationOutcome tests (branded, unforgeable) ─────────────────

describe('SealedReconciliationOutcome — trusted reconciliation enforcement', () => {
  const canonicalTaskId = 'task-recon-test';
  const reconIssuer = new TrustedReconciliationIssuer('audit-system');

  async function setupReconciling(): Promise<{ ledger: InMemoryEventLedger; coordinator: RunCoordinator }> {
    const ledger = new InMemoryEventLedger();
    const reviewer: StructuredReviewer = {
      reviewExecution: vi.fn().mockResolvedValue({ decision: 'AMBIGUOUS_SIDE_EFFECT', findings: ['Timed out mid-commit'] } ),
    };
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r-recon', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue(makeResult({ status: 'COMPLETED' })),
      cancel: vi.fn(),
    };
    const coordinator = new RunCoordinator(bridge, ledger, reviewer, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    await coordinator.execute(makeWp(), 'run-recon', 'corr-1', 'proj-1');
    const events = await ledger.getEvents('run-recon');
    expect(events.some(e => e.eventType === 'EVALUATION_AMBIGUOUS_SIDE_EFFECT')).toBe(true);
    return { ledger, coordinator };
  }

  it('forged plain reconciliation object is rejected', async () => {
    const { coordinator } = await setupReconciling();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forged: any = {
      safeToRetry: true,
      correlationId: 'corr-forged',
      causationId: 'cause-forged',
      verifiedBy: 'attacker',
      reason: 'trust me',
    };

    await expect(coordinator.resumeFromReconciliation('run-recon', forged))
      .rejects.toThrow(/Untrusted reconciliation outcome/);
  });

  it('public @co/workflow surface does not export reconciliation constructor, issuer, or factory', async () => {
    const Workflow = await import('@co/workflow');
    const publicKeys = Object.keys(Workflow);

    // Constructor value absent — no runtime class to instantiate
    expect('SealedReconciliationOutcome' in Workflow).toBe(false);
    // Issuer absent
    expect('TrustedReconciliationIssuer' in Workflow).toBe(false);
    // No public factory/mint function
    expect('isReconciliationOutcome' in Workflow).toBe(false);
    expect('createSealedReconciliationOutcome' in Workflow).toBe(false);
    expect(publicKeys.filter(k => /[Rr]econcil/i.test(k))).toEqual([]);

    // Canonical control-plane path (direct module import) can still access everything
    const Internal = await import('../../packages/workflow/src/run-coordinator.js');
    expect(Internal.TrustedReconciliationIssuer).toBeDefined();
    expect(Internal.SealedReconciliationOutcome).toBeDefined();
    expect(Internal.isReconciliationOutcome).toBeDefined();
  });

  it('canonical composition can mint a trusted outcome; forged plain object is rejected', async () => {
    const { isReconciliationOutcome: isRecon } = await import(
      '../../packages/workflow/src/run-coordinator.js'
    );

    // Forged plain object is rejected
    const forged = {
      safeToRetry: true,
      correlationId: 'corr-forged',
      causationId: 'cause-forged',
      verifiedBy: 'attacker',
      reason: 'trust me',
    };
    expect(isRecon(forged)).toBe(false);

    // Trusted issuer can produce a valid outcome
    const validOutcome = reconIssuer.issueOutcome({
      safeToRetry: true,
      correlationId: 'corr-valid',
      causationId: 'cause-valid',
      reason: 'legitimate',
    });
    expect(isRecon(validOutcome)).toBe(true);
  });

  it('unsafe trusted outcome blocks the run — no redispatch', async () => {
    const { ledger, coordinator } = await setupReconciling();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatchBefore = (coordinator as any).bridge.dispatch as ReturnType<typeof vi.fn>;
    const callsBefore = dispatchBefore.mock.calls.length;

    const unsafeOutcome = reconIssuer.issueOutcome({
      safeToRetry: false,
      correlationId: 'corr-unsafe',
      causationId: 'cause-1',
      reason: 'Action committed — retry would duplicate side effect',
    });

    await coordinator.resumeFromReconciliation('run-recon', unsafeOutcome);

    const events = await ledger.getEvents('run-recon');
    expect(events.some(e => e.eventType === 'RECONCILIATION_OUTCOME')).toBe(true);
    expect(events.some(e => e.eventType === 'RUN_BLOCKED')).toBe(true);
    // No extra dispatch
    expect(dispatchBefore.mock.calls.length).toBe(callsBefore);
  });

  it('safe trusted outcome allows exactly one redispatch', async () => {
    const ledger = new InMemoryEventLedger();
    let dispatches = 0;

    // First dispatch → AMBIGUOUS; second dispatch → COMPLETE
    const reviewerMock: StructuredReviewer = {
      reviewExecution: vi.fn()
        .mockResolvedValueOnce({ decision: 'AMBIGUOUS_SIDE_EFFECT', findings: ['timed out'] })
        .mockResolvedValue({ decision: 'COMPLETE' }),
    };
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockImplementation(async () => {
        dispatches++;
        return { runId: `r-${dispatches}`, status: 'RUNNING' } as AgentRunHandle;
      }),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue(makeResult({ status: 'COMPLETED' })),
      cancel: vi.fn(),
    };
    const coordinator = new RunCoordinator(bridge, ledger, reviewerMock, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    await coordinator.execute(makeWp(), 'run-safe', 'corr-2', 'proj-1');
    expect(dispatches).toBe(1);

    const safeOutcome = reconIssuer.issueOutcome({
      safeToRetry: true,
      correlationId: 'corr-safe',
      causationId: 'cause-2',
      reason: 'DB shows action was NOT committed — idempotent retry safe',
    });

    await coordinator.resumeFromReconciliation('run-safe', safeOutcome);

    // Exactly one additional dispatch, no more
    expect(dispatches).toBe(2);
    const events = await ledger.getEvents('run-safe');
    expect(events.some(e => e.eventType === 'RECONCILIATION_OUTCOME')).toBe(true);
    expect(events.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);
    expect(events.some(e => e.eventType === 'RUN_BLOCKED')).toBe(false);
  });

  it('calling resumeFromReconciliation on a non-RECONCILING run throws', async () => {
    const ledger = new InMemoryEventLedger();
    const reviewer: StructuredReviewer = {
      reviewExecution: vi.fn().mockResolvedValue({ decision: 'COMPLETE' }),
    };
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockResolvedValue(makeResult()),
      cancel: vi.fn(),
    };
    const coordinator = new RunCoordinator(bridge, ledger, reviewer, canonicalTaskId, { timeoutMs: 50, intervalMs: 10 });
    await coordinator.execute(makeWp(), 'run-closed', 'corr-3', 'proj-1');

    const outcome = reconIssuer.issueOutcome({
      safeToRetry: true,
      correlationId: 'corr-3',
      causationId: 'cause-3',
      reason: 'safe',
    });
    await expect(coordinator.resumeFromReconciliation('run-closed', outcome))
      .rejects.toThrow(/from reconciliation in state/);
  });
});
