import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  AgentRunHandle,
  AgentRunResult,
  AgentRuntimeContext,
  WorkPackage,
} from '@co/contracts';
import type {
  Attempt,
  AttemptState,
  WorkItem,
  WorkItemLifecycleState,
} from '@co/domain';

export interface WorkflowWorkStore {
  startAttempt(input: {
    attempt: Attempt;
    expectedWorkItemRevision: number;
  }): Promise<{ workItem: WorkItem; attempt: Attempt }>;

  transitionAttempt(input: {
    attemptId: string;
    to: AttemptState;
  }): Promise<Attempt>;

  bindAgentRun(input: { attemptId: string; agentRunId: string; agentAdapterId: string }): Promise<Attempt>;

  transitionWorkItem(input: {
    workItemId: string;
    expectedRevision: number;
    to: WorkItemLifecycleState;
  }): Promise<WorkItem>;
}

export interface ExecuteWorkItemInput {
  readonly workItem: WorkItem;
  readonly workPackage: WorkPackage;
  readonly adapter: AgentAdapter;
  readonly correlationId: string;
  readonly workflowRunId: string;
  readonly now?: Date;
}

export interface WorkflowExecutionResult {
  readonly workItem: WorkItem;
  readonly attempt: Attempt;
  readonly agentRun: AgentRunHandle | null;
  readonly agentResult: AgentRunResult | null;
}

export class WorkPackageWorkItemMismatchError extends Error {
  public readonly code = 'WORK_PACKAGE_WORK_ITEM_MISMATCH';
  public constructor(message: string) {
    super(message);
    this.name = 'WorkPackageWorkItemMismatchError';
  }
}

export class WorkItemNotReadyError extends Error {
  public readonly code = 'WORK_ITEM_NOT_READY';
  public constructor(public readonly workItemId: string, public readonly state: WorkItemLifecycleState) {
    super(`WorkItem ${workItemId} must be READY before execution; current state is ${state}.`);
    this.name = 'WorkItemNotReadyError';
  }
}

export class MinimalWorkflowEngine {
  public constructor(private readonly store: WorkflowWorkStore) {}

  public async execute(input: ExecuteWorkItemInput): Promise<WorkflowExecutionResult> {
    this.assertExecutable(input.workItem, input.workPackage);

    const now = input.now ?? new Date();
    const attemptId = randomUUID();
    const attempt: Attempt = {
      id: attemptId,
      projectId: input.workItem.projectId,
      workItemId: input.workItem.id,
      attemptNumber: 1,
      state: 'NOT_STARTED',
      workPackageVersion: input.workPackage.version,
      agentRunId: null,
      agentAdapterId: null,
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    let persisted = await this.store.startAttempt({
      attempt,
      expectedWorkItemRevision: input.workItem.revision,
    });

    await this.store.transitionAttempt({ attemptId, to: 'STARTING' });
    await this.store.transitionAttempt({ attemptId, to: 'RUNNING' });
    let workItem = await this.store.transitionWorkItem({
      workItemId: input.workItem.id,
      expectedRevision: persisted.workItem.revision,
      to: 'RUNNING',
    });

    const runtimeContext: AgentRuntimeContext = {
      correlationId: input.correlationId,
      workflowRunId: input.workflowRunId,
      attemptId,
      secretRefs: [],
    };

    let run: AgentRunHandle | null = null;
    try {
      run = await input.adapter.start(input.workPackage, runtimeContext);
      await this.store.bindAgentRun({
        attemptId,
        agentRunId: run.runId,
        agentAdapterId: input.adapter.identify().adapterId,
      });
    } catch {
      const failedAttempt = await this.store.transitionAttempt({ attemptId, to: 'FAILED' });
      workItem = await this.store.transitionWorkItem({
        workItemId: workItem.id,
        expectedRevision: workItem.revision,
        to: 'RECOVERY_REQUIRED',
      });
      return { workItem, attempt: failedAttempt, agentRun: null, agentResult: null };
    }

    if (run.status === 'WAITING_FOR_INPUT') {
      const interruptedAttempt = await this.store.transitionAttempt({ attemptId, to: 'INTERRUPTED' });
      workItem = await this.store.transitionWorkItem({
        workItemId: workItem.id,
        expectedRevision: workItem.revision,
        to: 'WAITING',
      });
      return { workItem, attempt: interruptedAttempt, agentRun: run, agentResult: null };
    }

    if (run.status === 'UNKNOWN') {
      const unknownAttempt = await this.store.transitionAttempt({ attemptId, to: 'UNKNOWN' });
      workItem = await this.store.transitionWorkItem({
        workItemId: workItem.id,
        expectedRevision: workItem.revision,
        to: 'RECOVERY_REQUIRED',
      });
      return { workItem, attempt: unknownAttempt, agentRun: run, agentResult: null };
    }

    let result: AgentRunResult;
    try {
      result = await input.adapter.getResult({ runId: run.runId });
    } catch {
      const failedAttempt = await this.store.transitionAttempt({ attemptId, to: 'FAILED' });
      workItem = await this.store.transitionWorkItem({
        workItemId: workItem.id,
        expectedRevision: workItem.revision,
        to: 'RECOVERY_REQUIRED',
      });
      return { workItem, attempt: failedAttempt, agentRun: run, agentResult: null };
    }

    const target = this.mapResult(result.status);
    const finalAttempt = await this.store.transitionAttempt({ attemptId, to: target.attemptState });
    workItem = await this.store.transitionWorkItem({
      workItemId: workItem.id,
      expectedRevision: workItem.revision,
      to: target.workItemState,
    });

    return { workItem, attempt: finalAttempt, agentRun: run, agentResult: result };
  }

  private assertExecutable(workItem: WorkItem, workPackage: WorkPackage): void {
    if (workItem.lifecycleState !== 'READY') {
      throw new WorkItemNotReadyError(workItem.id, workItem.lifecycleState);
    }
    if (workPackage.projectId !== workItem.projectId || workPackage.workItemId !== workItem.id) {
      throw new WorkPackageWorkItemMismatchError(
        `WorkPackage ${workPackage.workPackageId} does not target WorkItem ${workItem.id} in Project ${workItem.projectId}.`,
      );
    }
  }

  private mapResult(status: AgentRunResult['status']): {
    attemptState: AttemptState;
    workItemState: WorkItemLifecycleState;
  } {
    switch (status) {
      case 'COMPLETED':
        return { attemptState: 'SUCCEEDED', workItemState: 'VERIFICATION_REQUIRED' };
      case 'FAILED':
        return { attemptState: 'FAILED', workItemState: 'REPAIR_REQUIRED' };
      case 'INTERRUPTED':
        return { attemptState: 'INTERRUPTED', workItemState: 'RECOVERY_REQUIRED' };
      case 'CANCELLED':
        return { attemptState: 'CANCELLED', workItemState: 'RECOVERY_REQUIRED' };
    }
  }
}
