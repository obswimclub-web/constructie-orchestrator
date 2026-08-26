import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';
import { randomUUID } from 'crypto';

describe('RunCoordinator Reconciliation', () => {
  it('transitions to RECONCILING for ambiguous sensitive side effects without blind retries', async () => {
    let dispatchCount = 0;
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
      getResult: vi.fn().mockImplementation(async () => {
        dispatchCount++;
        return {
          schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'UNKNOWN',
          summary: 'AMBIGUOUS_SIDE_EFFECT: Execution timed out during sensitive operation (COMMIT).', actionsTaken: [], artifacts: [], findings: [], evidence: [],
          unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
        } as AgentRunResult;
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); },
      getEvents: async (id) => appendedEvents.filter(e => e.aggregateId === id)
    };

    const coordinator = new RunCoordinator(bridge, ledger);

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Commit sensitive code',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    // The coordinator should hit the ambiguous condition and break the loop
    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    // It should have only dispatched ONCE (no blind retry)
    expect(dispatchCount).toBe(1);

    // Verify correct event emission
    expect(appendedEvents.some(e => e.eventType === 'EVALUATION_AMBIGUOUS_SIDE_EFFECT')).toBe(true);
    const lastEvent = appendedEvents[appendedEvents.length - 1];
    expect(lastEvent.eventType).toBe('EVALUATION_AMBIGUOUS_SIDE_EFFECT');
  });
});
