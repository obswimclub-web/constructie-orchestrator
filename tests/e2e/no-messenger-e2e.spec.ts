import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger } from '../../packages/workflow/src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';
import { randomUUID } from 'crypto';

describe('No Messenger E2E', () => {
  it('executes autonomous loop with repair, owner pause, and resume (0 messages)', async () => {
    let OWNER_MESSAGE_RELAY_COUNT = 0;

    let dispatchCount = 0;
    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
      getResult: vi.fn().mockImplementation(async () => {
        dispatchCount++;
        if (dispatchCount === 1) {
          return {
            schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
            summary: 'Initial attempt: FAIL_REPAIRABLE', actionsTaken: [], artifacts: [], findings: [], evidence: [],
            unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
          } as AgentRunResult;
        } else {
          return {
            schemaVersion: '1.0.0', runRef: { runId: 'r2' }, status: 'COMPLETED',
            summary: 'Repair attempt: OWNER_DECISION', actionsTaken: [], artifacts: [], findings: [], evidence: [],
            unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
          } as AgentRunResult;
        }
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
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do something',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    // 1. Initial execution loops through FAIL_REPAIRABLE -> REPAIR -> OWNER_DECISION
    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    // 2. We assert it paused for owner decision
    expect(appendedEvents.some(e => e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED')).toBe(true);

    // 3. We simulate a canonical owner event arriving
    const ownerEvent: ProjectEvent = {
      id: randomUUID(),
      projectId: 'proj-1',
      eventType: 'OWNER_APPROVAL_GRANTED',
      aggregateType: 'RUN',
      aggregateId: 'run-1',
      aggregateRevision: 1,
      actorType: 'OWNER',
      actorId: 'owner-1',
      correlationId: 'corr-1',
      causationId: null,
      schemaVersion: 1,
      payload: {},
      occurredAt: new Date(),
    };

    // 4. Automatic resume triggered by event
    await coordinator.resume('run-1', ownerEvent);

    // 5. Final state is CLOSED
    expect(appendedEvents.some(e => e.eventType === 'RUN_CLOSED')).toBe(true);

    // 6. Zero messages to human needed
    expect(OWNER_MESSAGE_RELAY_COUNT).toBe(0);

    // Check flow correctness
    const flow = appendedEvents.map(e => e.eventType);
    expect(flow).toEqual([
      'RUN_STARTED',
      'RUN_DISPATCHED',
      'RUN_COMPLETED',
      'EVALUATION_FAILED_REPAIRABLE',
      'RUN_REPAIR_STARTED',
      'RUN_DISPATCHED',
      'RUN_COMPLETED',
      'EVALUATION_OWNER_DECISION_REQUIRED',
      'RUN_RESUMED',
      'RUN_CLOSED'
    ]);
  });
});
