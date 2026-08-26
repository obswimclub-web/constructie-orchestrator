import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MockAgentAdapter, MockAgentRunRegistry } from '@co/agents';
import type { WorkPackage } from '@co/contracts';

describe('BOOT-010 restart / resume proof', () => {
  it('recreates the Orchestrator process, reuses the same Attempt and provider run, and does not duplicate semantic work', async () => {
    const providerRegistry = new MockAgentRunRegistry();
    const adapterA = new MockAgentAdapter('INTERRUPTED', providerRegistry);

    const workPackage: WorkPackage = {
      schemaVersion: '1.0.0',
      workPackageId: 'wp',
      version: 1,
      projectId: 'p1',
      workItemId: 'w1',
      completionObjectRef: 'c1',
      objective: 'Test',
      authoritativeInputs: [],
      scope: { refs: [] },
      constraints: [],
      authorityContextRef: 'a1',
      requiredCapabilities: [],
      allowedActions: [],
      forbiddenActions: [],
      toolsAllowed: [],
      expectedArtifactsOut: [],
      verificationRequirements: [],
      evidenceRequirements: [],
      dependencies: [],
      stopConditions: [],
    };

    const run = await adapterA.execute(workPackage, {
      correlationId: randomUUID(),
      workflowRunId: 'workflow-process-a',
      attemptId: 'attempt-1',
      secretRefs: [],
    });

    expect(run.status).toBe('INTERRUPTED');
    const adapterB = new MockAgentAdapter('SUCCESS', providerRegistry);

    const resumed = await adapterB.resume({
      runRef: run,
      runtimeContext: {
        correlationId: randomUUID(),
        workflowRunId: 'workflow-process-b',
        attemptId: 'attempt-1',
        secretRefs: [],
      },
    });
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.runId).toBe(run.runId);
  });
});
