import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MockAgentAdapter, MockAgentRunRegistry } from '@co/agents';
import { WORK_PACKAGE_SCHEMA_VERSION, type WorkPackage } from '@co/contracts';
import {
  assertAttemptTransition,
  assertWorkItemTransition,
  createWorkItem,
  isActiveAttemptState,
  type Attempt,
  type AttemptState,
  type WorkItem,
  type WorkItemLifecycleState,
} from '@co/domain';
import {
  WorkflowResumeCoordinator,
  type WorkflowResumeStore,
} from '@co/workflow';

class DurableMemoryDb {
  readonly work = new Map<string, WorkItem>();
  readonly attempts = new Map<string, Attempt>();
}

class DurableWorkStore implements WorkflowResumeStore {
  constructor(private readonly db: DurableMemoryDb) {}

  async getWorkItem(workItemId: string): Promise<WorkItem> {
    const item = this.db.work.get(workItemId);
    if (!item) throw new Error('work missing');
    return item;
  }

  async getAttempt(attemptId: string): Promise<Attempt> {
    const attempt = this.db.attempts.get(attemptId);
    if (!attempt) throw new Error('attempt missing');
    return attempt;
  }

  async transitionAttempt(input: { attemptId: string; to: AttemptState }): Promise<Attempt> {
    const current = await this.getAttempt(input.attemptId);
    assertAttemptTransition(current.state, input.to);
    const now = new Date('2026-08-20T12:30:00Z');
    const next: Attempt = {
      ...current,
      state: input.to,
      startedAt: input.to === 'RUNNING' && current.startedAt === null ? now : current.startedAt,
      endedAt: isActiveAttemptState(input.to) ? null : now,
      updatedAt: now,
    };
    this.db.attempts.set(next.id, next);
    if (!isActiveAttemptState(next.state)) {
      const work = await this.getWorkItem(next.workItemId);
      if (work.currentAttemptId === next.id) {
        this.db.work.set(work.id, { ...work, currentAttemptId: null, updatedAt: now });
      }
    }
    return next;
  }

  async transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }): Promise<WorkItem> {
    const current = await this.getWorkItem(input.workItemId);
    if (current.revision !== input.expectedRevision) throw new Error('revision conflict');
    assertWorkItemTransition(current.lifecycleState, input.to);
    const next: WorkItem = {
      ...current,
      lifecycleState: input.to,
      revision: current.revision + 1,
      updatedAt: new Date('2026-08-20T12:30:00Z'),
    };
    this.db.work.set(next.id, next);
    return next;
  }
}

describe('BOOT-010 restart / resume proof', () => {
  it('recreates the Orchestrator process, reuses the same Attempt and provider run, and does not duplicate semantic work', async () => {
    const now = new Date('2026-08-20T12:00:00Z');
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const attemptId = randomUUID();
    const db = new DurableMemoryDb();
    const providerRegistry = new MockAgentRunRegistry();

    const draft = createWorkItem({
      id: workItemId,
      projectId,
      parentId: null,
      type: 'TASK',
      objective: 'Resume the interrupted governed run',
      now,
    });
    const ready: WorkItem = { ...draft, lifecycleState: 'READY', revision: 2 };
    const running: WorkItem = {
      ...ready,
      lifecycleState: 'RUNNING',
      revision: 4,
      currentAttemptId: attemptId,
    };
    db.work.set(running.id, running);

    const workPackage: WorkPackage = {
      schemaVersion: WORK_PACKAGE_SCHEMA_VERSION,
      workPackageId: randomUUID(),
      version: 1,
      projectId,
      workItemId,
      completionObjectRef: `work-item:${workItemId}`,
      objective: running.objective,
      authoritativeInputs: [],
      scope: { refs: [`work-item:${workItemId}`] },
      constraints: [],
      authorityContextRef: 'authority://boot-010',
      requiredCapabilities: ['code_generation'],
      allowedActions: ['mock.execute'],
      forbiddenActions: [],
      toolsAllowed: ['mock'],
      expectedArtifactsOut: ['PATCH'],
      verificationRequirements: ['TEST'],
      evidenceRequirements: ['CURRENT'],
      dependencies: [],
      stopConditions: [],
    };

    const adapterA = new MockAgentAdapter('INTERRUPTED', providerRegistry);
    const run = await adapterA.start(workPackage, {
      correlationId: randomUUID(),
      workflowRunId: 'workflow-process-a',
      attemptId,
      secretRefs: [],
    });
    const attempt: Attempt = {
      id: attemptId,
      projectId,
      workItemId,
      attemptNumber: 1,
      state: 'RUNNING',
      workPackageVersion: 1,
      agentRunId: run.runId,
      agentAdapterId: adapterA.identify().adapterId,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.attempts.set(attempt.id, attempt);
    expect(db.attempts.size).toBe(1);

    const storeB = new DurableWorkStore(db);
    const adapterB = new MockAgentAdapter('SUCCESS', providerRegistry);
    const coordinator = new WorkflowResumeCoordinator(storeB);
    const resumed = await coordinator.reconcileAndResume({
      workItemId,
      workPackage,
      adapter: adapterB,
      correlationId: randomUUID(),
      workflowRunId: 'workflow-process-b',
    });

    expect(resumed.disposition).toBe('RECONCILED_EXISTING_RUN');
    expect(resumed.attempt?.id).toBe(attemptId);
    expect(resumed.attempt?.attemptNumber).toBe(1);
    expect(resumed.attempt?.state).toBe('SUCCEEDED');
    expect(resumed.agentResult?.status).toBe('COMPLETED');
    expect(resumed.workItem.lifecycleState).toBe('VERIFICATION_REQUIRED');
    expect(db.attempts.size).toBe(1);
    expect(providerRegistry.runs.size).toBe(1);
  });
});
