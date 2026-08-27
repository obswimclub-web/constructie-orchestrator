import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger, type StructuredReviewer } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';
import { randomUUID } from 'crypto';

describe('RunCoordinator Reconciliation', () => {
  it('transitions to RECONCILING for ambiguous transport outcome without blind retries', async () => {
    let dispatchCount = 0;
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('RUNNING'), // Causes timeout
      getResult: vi.fn().mockRejectedValue(new Error('Connection lost')),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const reviewer: StructuredReviewer = {
      reviewExecution: vi.fn().mockResolvedValue({ decision: 'COMPLETE' })
    };

    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); },
      getEvents: async (id) => appendedEvents.filter(e => e.aggregateId === id)
    };

    const coordinator = new RunCoordinator(bridge, ledger, reviewer, 'task-abc', { timeoutMs: 50, intervalMs: 10 });

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Commit sensitive code',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    expect(bridge.dispatch).toHaveBeenCalledTimes(1);

    expect(appendedEvents.some(e => e.eventType === 'EVALUATION_AMBIGUOUS_SIDE_EFFECT')).toBe(true);
    const lastEvent = appendedEvents[appendedEvents.length - 1];
    expect(lastEvent.eventType).toBe('EVALUATION_AMBIGUOUS_SIDE_EFFECT');
  });
});
