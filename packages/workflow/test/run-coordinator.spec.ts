import { describe, it, expect, vi } from 'vitest';
import { RunCoordinator, type EventLedger } from '../src/run-coordinator.js';
import type { AgentBridge, WorkPackage, AgentRunResult, AgentRunHandle } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';

describe('RunCoordinator', () => {
  it('dispatches work and records append-only events', async () => {
    const appendedEvents: ProjectEvent[] = [];
    const ledger: EventLedger = {
      append: async (e) => { appendedEvents.push(e); }
    };

    const mockResult: AgentRunResult = {
      schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
      summary: 'Done', actionsTaken: [], artifacts: [], findings: [], evidence: [],
      unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
    };

    const bridge: AgentBridge = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'r1', status: 'RUNNING' } as AgentRunHandle),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
      getResult: vi.fn().mockResolvedValue(mockResult),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const coordinator = new RunCoordinator(bridge, ledger);

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
      workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do nothing',
      authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
      dependencies: [], stopConditions: [],
    };

    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');

    expect(bridge.dispatch).toHaveBeenCalled();
    expect(bridge.getResult).toHaveBeenCalled();

    expect(appendedEvents).toHaveLength(4);
    expect(appendedEvents[3].eventType).toBe('RUN_CLOSED');
    expect(appendedEvents[0].eventType).toBe('RUN_STARTED');
    expect(appendedEvents[1].eventType).toBe('RUN_DISPATCHED');
    expect(appendedEvents[2].eventType).toBe('RUN_COMPLETED');
    expect((appendedEvents[2].payload as any).result.status).toBe('COMPLETED');
  });
});
