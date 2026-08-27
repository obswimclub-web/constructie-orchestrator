import { TrustedOwnerAuthorityIssuer } from '@co/policy';
import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger, type StructuredReviewer } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';

describe('No Messenger E2E', () => {
  it('executes autonomous loop with repair, owner pause, and resume with post-approval dispatch', async () => {
    const OWNER_MESSAGE_RELAY_COUNT = 0;

    let dispatchCount = 0;
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('COMPLETED'),
      getResult: vi.fn().mockImplementation(async () => {
        dispatchCount++;
        return {
          schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
          summary: `Mock output ${dispatchCount}`, actionsTaken: [], artifacts: [], findings: [], evidence: [],
          unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
        } as AgentRunResult;
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const reviewer: StructuredReviewer = {
      reviewExecution: async () => {
        if (dispatchCount === 1) return { decision: 'FAIL_REPAIRABLE', feedback: 'Needs fix' };
        if (dispatchCount === 2) return { decision: 'OWNER_DECISION_REQUIRED', feedback: 'Needs owner auth', pendingAction: 'generic_action', pendingGate: 'gate-1', pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED' };
        if (dispatchCount === 3) return { decision: 'PASS', nextAction: 'Next step' };
        if (dispatchCount === 4) return { decision: 'COMPLETE' };
        return { decision: 'COMPLETE' };
      }
    };

    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); },
      getEvents: async (id) => appendedEvents.filter(e => e.aggregateId === id)
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, 'task-abc', { timeoutMs: 50, intervalMs: 10 });

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do something',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    // 1. Initial execution loops through FAIL_REPAIRABLE -> REPAIR -> OWNER_DECISION
    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    expect(dispatchCount).toBe(2);
    expect(appendedEvents.some(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED')).toBe(true);

    // Ensure RUN_CLOSED was NOT emitted yet
    expect(appendedEvents.some(e => e.eventType === 'RUN_CLOSED')).toBe(false);

    // 3. We simulate a canonical owner event arriving
    const issuer = new TrustedOwnerAuthorityIssuer('owner-1', 'task-abc');
    const issuerResult = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED', boundToAction: 'generic_action', boundToGate: 'gate-1' });
const ownerEvent = issuerResult;

    // 4. Automatic resume triggered by event. It should re-enter the loop, dispatch again, and then close.
    await coordinator.resumeWithAuthority('run-1', ownerEvent);

    expect(dispatchCount).toBe(4); // Post-approval dispatch happened!
    expect(bridge.dispatch).toHaveBeenCalledTimes(4);
    const postApprovalWp = vi.mocked(bridge.dispatch).mock.calls[2][0];
    expect(postApprovalWp.objective).toBe('Repair feedback: Needs fix\nOriginal: Do something');
    const finalWp = vi.mocked(bridge.dispatch).mock.calls[3][0];
    expect(finalWp.objective).toBe('Next step'); // Objective is preserved exactly
    expect(appendedEvents.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);

    expect(OWNER_MESSAGE_RELAY_COUNT).toBe(0);
  });
});
