import { describe, expect, it } from 'vitest';
import {
  GateTransitionNotPermittedError,
  GrantNotFoundError,
  OwnerEventProcessor,
  TaskMismatchError,
  TrustedOwnerAuthorityIssuer,
  UntrustedOwnerEventError,
} from '@co/policy';

const TASK_ID = 'task-policy-001';
const OWNER_REF = 'owner:human';

function makeIssuer(taskId = TASK_ID) {
  return new TrustedOwnerAuthorityIssuer(OWNER_REF, taskId);
}

function makeProcessor(initialGate = 'AUDIT' as const) {
  return new OwnerEventProcessor({ taskId: TASK_ID, initialGate, environment: 'LOCAL' });
}

describe('OwnerEventProcessor — initialization', () => {
  it('initializes with correct gate and environment', () => {
    const processor = makeProcessor('AUDIT');
    const view = processor.readOnlyView;
    expect(view.gate).toBe('AUDIT');
    expect(view.environment).toBe('LOCAL');
  });

  it('starts with no active authorities', () => {
    const view = makeProcessor().readOnlyView;
    expect(view.activeAuthorities).toHaveLength(0);
    expect(view.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
  });

  it('starts with empty approved file scope', () => {
    const view = makeProcessor().readOnlyView;
    expect(view.approvedFiles).toHaveLength(0);
    expect(view.isFileApproved('src/any.ts')).toBe(false);
  });
});

describe('OwnerEventProcessor — authority grants', () => {
  it('applies a trusted authority event — hasAuthority returns true', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const event = issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    processor.applyOwnerAuthorityEvent(event);
    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);
  });

  it('rejects an unbranded plain object — UntrustedOwnerEventError', () => {
    const processor = makeProcessor();
    // A plain object (even with correct fields) is NOT a trusted event
    const forgedEvent = { authorityType: 'OWNER_COMMIT_APPROVED', taskId: TASK_ID, source: 'OWNER_EXPLICIT_REQUEST' };
    expect(() => processor.applyOwnerAuthorityEvent(forgedEvent as never)).toThrow(UntrustedOwnerEventError);
  });

  it('rejects event with mismatched taskId — TaskMismatchError', () => {
    const wrongIssuer = makeIssuer('different-task-id');
    const processor = makeProcessor();
    const event = wrongIssuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    expect(() => processor.applyOwnerAuthorityEvent(event)).toThrow(TaskMismatchError);
  });

  it('activeAuthorities returns immutable snapshot — new array on each call', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const event = issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    processor.applyOwnerAuthorityEvent(event);
    const snap1 = processor.readOnlyView.activeAuthorities;
    const snap2 = processor.readOnlyView.activeAuthorities;
    expect(snap1).not.toBe(snap2); // different array references
    expect(snap1).toHaveLength(1);
  });
});

describe('OwnerEventProcessor — gate transitions', () => {
  it('transitions AUDIT → PLAN (no token required)', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('AUDIT');
    const transitionEvent = issuer.issueGateTransitionEvent({ fromGate: 'AUDIT', toGate: 'PLAN' });
    processor.transitionGateFromEvent(transitionEvent);
    expect(processor.readOnlyView.gate).toBe('PLAN');
  });

  it('PLAN → IMPLEMENTATION requires OWNER_IMPLEMENTATION_APPROVED — denied without token', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('PLAN');
    const transitionEvent = issuer.issueGateTransitionEvent({ fromGate: 'PLAN', toGate: 'IMPLEMENTATION' });
    // No authority granted
    expect(() => processor.transitionGateFromEvent(transitionEvent)).toThrow(GateTransitionNotPermittedError);
    expect(processor.readOnlyView.gate).toBe('PLAN'); // gate did NOT advance
  });

  it('OWNER_PLAN_REVIEW → IMPLEMENTATION succeeds with OWNER_IMPLEMENTATION_APPROVED token', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('OWNER_PLAN_REVIEW');
    // Issue and apply authority grant
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);
    // Issue and apply gate transition
    const transitionEvent = issuer.issueGateTransitionEvent({ fromGate: 'OWNER_PLAN_REVIEW', toGate: 'IMPLEMENTATION' });
    processor.transitionGateFromEvent(transitionEvent);
    expect(processor.readOnlyView.gate).toBe('IMPLEMENTATION');
    // Token NOT consumed by gate transition — still ACTIVE
    expect(processor.readOnlyView.hasAuthority('OWNER_IMPLEMENTATION_APPROVED')).toBe(true);
  });

  it('gate transition does NOT consume the required token', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('OWNER_PLAN_REVIEW');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);
    const transitionEvent = issuer.issueGateTransitionEvent({ fromGate: 'OWNER_PLAN_REVIEW', toGate: 'IMPLEMENTATION' });
    processor.transitionGateFromEvent(transitionEvent);
    // Token still ACTIVE after transition
    expect(processor.readOnlyView.hasAuthority('OWNER_IMPLEMENTATION_APPROVED')).toBe(true);
    expect(processor.readOnlyView.activeAuthorities.find(a => a.token === 'OWNER_IMPLEMENTATION_APPROVED')?.status).toBe('ACTIVE');
  });

  it('rejects undefined transition (COMMIT → AUDIT) — GateTransitionNotPermittedError', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const transitionEvent = issuer.issueGateTransitionEvent({ fromGate: 'COMMIT', toGate: 'AUDIT' });
    expect(() => processor.transitionGateFromEvent(transitionEvent)).toThrow(GateTransitionNotPermittedError);
  });

  it('rejects unbranded gate transition event', () => {
    const processor = makeProcessor();
    const forged = { fromGate: 'AUDIT', toGate: 'PLAN', taskId: TASK_ID };
    expect(() => processor.transitionGateFromEvent(forged as never)).toThrow(UntrustedOwnerEventError);
  });
});

describe('OwnerEventProcessor — approved file scope', () => {
  it('sets approved file scope from trusted event', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const scopeEvent = issuer.issueApprovedScopeEvent({ approvedFiles: ['src/foo.ts', 'src/bar.ts'] });
    processor.setApprovedScopeFromPlan(scopeEvent);
    expect(processor.readOnlyView.isFileApproved('src/foo.ts')).toBe(true);
    expect(processor.readOnlyView.isFileApproved('src/baz.ts')).toBe(false);
  });

  it('replaces previous scope on second event', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const first = issuer.issueApprovedScopeEvent({ approvedFiles: ['src/old.ts'] });
    processor.setApprovedScopeFromPlan(first);
    const second = issuer.issueApprovedScopeEvent({ approvedFiles: ['src/new.ts'] });
    processor.setApprovedScopeFromPlan(second);
    expect(processor.readOnlyView.isFileApproved('src/old.ts')).toBe(false);
    expect(processor.readOnlyView.isFileApproved('src/new.ts')).toBe(true);
  });

  it('approvedFiles snapshot is a new array each call — no internal Set reference escapes', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor();
    const scopeEvent = issuer.issueApprovedScopeEvent({ approvedFiles: ['src/a.ts'] });
    processor.setApprovedScopeFromPlan(scopeEvent);
    const snap1 = processor.readOnlyView.approvedFiles;
    const snap2 = processor.readOnlyView.approvedFiles;
    expect(snap1).not.toBe(snap2); // different array instances
    expect(snap1).toEqual(['src/a.ts']);
  });

  it('rejects unbranded scope event', () => {
    const processor = makeProcessor();
    const forged = { approvedFiles: ['src/foo.ts'], taskId: TASK_ID };
    expect(() => processor.setApprovedScopeFromPlan(forged as never)).toThrow(UntrustedOwnerEventError);
  });
});

describe('OwnerEventProcessor — grant state machine (ISSUED → ACTIVE → RESERVED → CONSUMED)', () => {
  it('grant lifecycle: ACTIVE → RESERVED → CONSUMED on success', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('PUSH');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_PUSH_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);
    expect(processor.readOnlyView.hasAuthority('OWNER_PUSH_APPROVED')).toBe(true);

    const grantConsumer = processor.asGrantConsumer();
    const actionId = 'action-git-push-001';

    // RESERVE before execution
    grantConsumer.reserveGrant(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_PUSH_APPROVED')!.grantId, actionId);
    const reservedGrant = processor.readOnlyView.activeAuthorities.find(a => a.token === 'OWNER_PUSH_APPROVED');
    expect(reservedGrant?.status).toBe('RESERVED');
    expect(reservedGrant?.reservedForActionId).toBe(actionId);
    // hasAuthority returns false when RESERVED
    expect(processor.readOnlyView.hasAuthority('OWNER_PUSH_APPROVED')).toBe(false);

    // CONSUME after success
    grantConsumer.consumeGrant(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_PUSH_APPROVED')!.grantId, actionId);
    const consumedGrant = processor.readOnlyView.activeAuthorities.find(a => a.token === 'OWNER_PUSH_APPROVED');
    expect(consumedGrant?.status).toBe('CONSUMED');
    expect(processor.readOnlyView.hasAuthority('OWNER_PUSH_APPROVED')).toBe(false);
  });

  it('grant NOT consumed after TIMED_OUT — becomes RECONCILIATION_REQUIRED', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('PUSH');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_PUSH_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);

    const grantConsumer = processor.asGrantConsumer();
    const actionId = 'action-timedout-001';
    grantConsumer.reserveGrant(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_PUSH_APPROVED')!.grantId, actionId);
    grantConsumer.requireReconciliation(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_PUSH_APPROVED')!.grantId, actionId);

    const grant = processor.readOnlyView.activeAuthorities.find(a => a.token === 'OWNER_PUSH_APPROVED');
    expect(grant?.status).toBe('RECONCILIATION_REQUIRED');
    // Grant CANNOT be used for retry
    expect(processor.readOnlyView.hasAuthority('OWNER_PUSH_APPROVED')).toBe(false);
  });

  it('grant released for retry after CANCELLED (proven not executed)', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('COMMIT');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);

    const grantConsumer = processor.asGrantConsumer();
    const actionId = 'action-cancelled-001';
    grantConsumer.reserveGrant(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED')!.grantId, actionId);
    // Execution cancelled before side effect
    grantConsumer.releaseGrantForRetry(processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED')!.grantId, actionId);

    const grant = processor.readOnlyView.activeAuthorities.find(a => a.token === 'OWNER_COMMIT_APPROVED');
    expect(grant?.status).toBe('ACTIVE');
    // Grant is available again for retry
    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);
  });

  it('throws GrantNotFoundError on consumeGrant without reserve', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('PUSH');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_PUSH_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);

    const grantConsumer = processor.asGrantConsumer();
    // Not reserved — cannot consume directly
    expect(() => grantConsumer.consumeGrant('OWNER_PUSH_APPROVED', 'some-action')).toThrow(GrantNotFoundError);
  });

  it('ReadOnlyExecutionContext has no mutation methods (type-safety verified at runtime)', () => {
    const processor = makeProcessor();
    const view = processor.readOnlyView;
    // These methods must NOT exist on the view
    expect((view as Record<string, unknown>)['grantAuthority']).toBeUndefined();
    expect((view as Record<string, unknown>)['transitionGate']).toBeUndefined();
    expect((view as Record<string, unknown>)['setApprovedFileScope']).toBeUndefined();
    expect((view as Record<string, unknown>)['addApprovedFile']).toBeUndefined();
    expect((view as Record<string, unknown>)['applyOwnerAuthorityEvent']).toBeUndefined();
  });
});

describe('OwnerEventProcessor — audit log', () => {
  it('records all state changes in audit log', () => {
    const issuer = makeIssuer();
    const processor = makeProcessor('AUDIT');

    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED' });
    processor.applyOwnerAuthorityEvent(authEvent);

    const planEvent = issuer.issueGateTransitionEvent({ fromGate: 'AUDIT', toGate: 'PLAN' });
    processor.transitionGateFromEvent(planEvent);

    const scopeEvent = issuer.issueApprovedScopeEvent({ approvedFiles: ['src/foo.ts'] });
    processor.setApprovedScopeFromPlan(scopeEvent);

    const log = processor.readOnlyView.auditLog();
    expect(log.some(e => e.event.includes('GATE_INIT'))).toBe(true);
    expect(log.some(e => e.event.includes('AUTHORITY_GRANTED'))).toBe(true);
    expect(log.some(e => e.event.includes('GATE_TRANSITION'))).toBe(true);
    expect(log.some(e => e.event.includes('FILE_SCOPE_SET'))).toBe(true);
  });

  it('auditLog snapshot is a new array each call', () => {
    const processor = makeProcessor();
    const snap1 = processor.readOnlyView.auditLog();
    const snap2 = processor.readOnlyView.auditLog();
    expect(snap1).not.toBe(snap2);
  });
});
