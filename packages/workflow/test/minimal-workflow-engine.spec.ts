import { describe, expect, it } from 'vitest';
import { MockAgentAdapter } from '@co/agents';
import type { WorkPackage } from '@co/contracts';
import {
  assertAttemptTransition,
  assertWorkItemTransition,
  type Attempt,
  type AttemptState,
  type WorkItem,
  type WorkItemLifecycleState,
} from '@co/domain';
import { MinimalWorkflowEngine, type WorkflowWorkStore } from '../src/index.js';

class InMemoryWorkStore implements WorkflowWorkStore {
  constructor(public workItem: WorkItem) {}
  attempt: Attempt | null = null;

  async startAttempt(input: { attempt: Attempt; expectedWorkItemRevision: number }) {
    if (this.workItem.revision !== input.expectedWorkItemRevision) throw new Error('stale');
    assertWorkItemTransition(this.workItem.lifecycleState, 'ASSIGNED');
    this.attempt = input.attempt;
    this.workItem = { ...this.workItem, lifecycleState: 'ASSIGNED', currentAttemptId: input.attempt.id, revision: this.workItem.revision + 1 };
    return { workItem: this.workItem, attempt: input.attempt };
  }

  async bindAgentRun(input: { attemptId: string; agentRunId: string; agentAdapterId: string }) {
    if (!this.attempt || this.attempt.id !== input.attemptId) throw new Error('missing attempt');
    this.attempt = { ...this.attempt, agentRunId: input.agentRunId, agentAdapterId: input.agentAdapterId };
    return this.attempt;
  }

  async transitionAttempt(input: { attemptId: string; to: AttemptState }) {
    if (!this.attempt || this.attempt.id !== input.attemptId) throw new Error('missing attempt');
    assertAttemptTransition(this.attempt.state, input.to);
    const terminal = ['SUCCEEDED','FAILED','TIMED_OUT','INTERRUPTED','CANCELLED'].includes(input.to);
    this.attempt = { ...this.attempt, state: input.to, endedAt: terminal ? new Date() : null };
    if (terminal) this.workItem = { ...this.workItem, currentAttemptId: null };
    return this.attempt;
  }

  async transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }) {
    if (this.workItem.id !== input.workItemId || this.workItem.revision !== input.expectedRevision) throw new Error('stale');
    assertWorkItemTransition(this.workItem.lifecycleState, input.to);
    this.workItem = { ...this.workItem, lifecycleState: input.to, revision: this.workItem.revision + 1 };
    return this.workItem;
  }
}

const baseWork: WorkItem = {
  id: 'work-1', projectId: 'project-1', parentId: null, type: 'TASK', objective: 'Create patch',
  lifecycleState: 'READY', revision: 2, currentAttemptId: null,
  createdAt: new Date('2026-08-20T00:00:00Z'), updatedAt: new Date('2026-08-20T00:00:00Z'),
};

const wp: WorkPackage = {
  schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'project-1', workItemId: 'work-1', completionObjectRef: 'feature-1', objective: 'Create patch',
  authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'authority-1', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: ['PATCH'], verificationRequirements: ['tests'], evidenceRequirements: ['patch'], dependencies: [], stopConditions: [],
};

describe('MinimalWorkflowEngine', () => {
  it('maps agent COMPLETED to VERIFICATION_REQUIRED, never directly to COMPLETED', async () => {
    const store = new InMemoryWorkStore(baseWork);
    const engine = new MinimalWorkflowEngine(store);
    const result = await engine.execute({ workItem: baseWork, workPackage: wp, adapter: new MockAgentAdapter('SUCCESS'), correlationId: 'c1', workflowRunId: 'wf1' });
    expect(result.attempt.state).toBe('SUCCEEDED');
    expect(result.workItem.lifecycleState).toBe('VERIFICATION_REQUIRED');
    expect(result.agentResult?.artifacts).toHaveLength(1);
  });

  it('maps agent failure to REPAIR_REQUIRED', async () => {
    const store = new InMemoryWorkStore(baseWork);
    const result = await new MinimalWorkflowEngine(store).execute({ workItem: baseWork, workPackage: wp, adapter: new MockAgentAdapter('FAIL'), correlationId: 'c2', workflowRunId: 'wf2' });
    expect(result.attempt.state).toBe('FAILED');
    expect(result.workItem.lifecycleState).toBe('REPAIR_REQUIRED');
  });

  it('maps malformed provider output to RECOVERY_REQUIRED', async () => {
    const store = new InMemoryWorkStore(baseWork);
    const result = await new MinimalWorkflowEngine(store).execute({ workItem: baseWork, workPackage: wp, adapter: new MockAgentAdapter('MALFORMED_RESULT'), correlationId: 'c3', workflowRunId: 'wf3' });
    expect(result.attempt.state).toBe('FAILED');
    expect(result.workItem.lifecycleState).toBe('RECOVERY_REQUIRED');
    expect(result.agentResult).toBeNull();
  });
});
