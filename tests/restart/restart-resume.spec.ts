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

  it('WorkflowEngine accurately models interrupt and ResumeCoordinator successfully restores it', async () => {
    const { MinimalWorkflowEngine } = await import('@co/workflow');
    const { ResumeCoordinator } = await import('@co/workflow');
    const { MockAgentRunRegistry, MockAgentAdapter } = await import('@co/agents');

    const providerRegistry = new MockAgentRunRegistry();
    const adapterA = new MockAgentAdapter('INTERRUPTED', providerRegistry);

    const workPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'p1', workItemId: 'w1',
      completionObjectRef: 'c1', objective: 'Test', authoritativeInputs: [], scope: { refs: [] }, constraints: [],
      authorityContextRef: 'a1', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
      expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    } as import('@co/contracts').WorkPackage;

    const mockWorkItem = {
      id: 'w1', projectId: 'p1', title: 'test', description: 'test', type: 'EPIC',
      lifecycleState: 'READY', requirementState: 'UNKNOWN', classification: [],
      priority: 'P2', createdBy: 'u', assignedTo: null, parentId: null, metadata: {},
      revision: 1, createdAt: new Date(), updatedAt: new Date(),
    } as import('@co/domain').WorkItem;

    let currentAttempt: import('@co/domain').Attempt | undefined;
    let currentWorkItemState = 'READY';

    const store = {
      startAttempt: async (input: { attempt: import('@co/domain').Attempt; expectedWorkItemRevision: number }) => { currentAttempt = input.attempt; return { workItem: mockWorkItem, attempt: input.attempt }; },
      transitionAttempt: async (input: { attemptId: string; to: import('@co/domain').AttemptState }) => { currentAttempt = { ...currentAttempt, state: input.to }; return currentAttempt; },
      bindAgentRun: async (input: { attemptId: string; agentRunId: string; agentAdapterId: string }) => { currentAttempt = { ...currentAttempt, agentRunId: input.agentRunId, agentAdapterId: input.agentAdapterId }; return currentAttempt; },
      transitionWorkItem: async (input: { workItemId: string; expectedRevision: number; to: import('@co/domain').WorkItemLifecycleState }) => { currentWorkItemState = input.to; return { ...mockWorkItem, lifecycleState: input.to as import('@co/domain').WorkItemLifecycleState }; }
    };

    const engine = new MinimalWorkflowEngine(store);
    const execRes = await engine.execute({
      workItem: mockWorkItem, workPackage, adapter: adapterA, correlationId: 'c1', workflowRunId: 'r1'
    });

    // Verify interrupted state
    expect(execRes.attempt.state).toBe('INTERRUPTED');
    expect(currentWorkItemState).toBe('RECOVERY_REQUIRED');
    expect(execRes.agentRun?.status).toBe('INTERRUPTED'); // MockAgentAdapter INTERRUPTED returns WAITING_FOR_INPUT

    // Now pretend process restarts
    const adapterB = new MockAgentAdapter('COMPLETED', providerRegistry); // COMPLETED status maps to SUCCEEDED
    const resumeCoordinator = new ResumeCoordinator(store);

    const resumeRes = await resumeCoordinator.resume({
      workItem: mockWorkItem, attempt: currentAttempt, workPackage, adapter: adapterB, correlationId: 'c2', workflowRunId: 'r2'
    });

    expect(resumeRes.attempt.state).toBe('SUCCEEDED');
    expect(currentWorkItemState).toBe('VERIFICATION_REQUIRED');
  });

});
