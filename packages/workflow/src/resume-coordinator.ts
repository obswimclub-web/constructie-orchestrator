import type { AgentAdapter, AgentRunResult, AgentRunStatus, AgentRuntimeContext, WorkPackage } from '@co/contracts';
import type { Attempt, AttemptState, WorkItem, WorkItemLifecycleState } from '@co/domain';

export interface WorkflowResumeStore {
  getWorkItem(workItemId: string): Promise<WorkItem>;
  getAttempt(attemptId: string): Promise<Attempt>;
  transitionAttempt(input: { attemptId: string; to: AttemptState }): Promise<Attempt>;
  transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }): Promise<WorkItem>;
}

export interface ResumeInput {
  readonly workItemId: string;
  readonly workPackage: WorkPackage;
  readonly adapter: AgentAdapter;
  readonly correlationId: string;
  readonly workflowRunId: string;
}

export interface ResumeResult {
  readonly disposition: 'NOTHING_TO_RESUME' | 'RESUMED_EXISTING_RUN' | 'RECONCILED_EXISTING_RUN' | 'RECOVERY_REQUIRED';
  readonly workItem: WorkItem;
  readonly attempt: Attempt | null;
  readonly agentResult: AgentRunResult | null;
}

export class ResumeStateMismatchError extends Error {
  public readonly code = 'RESUME_STATE_MISMATCH';
}

export class WorkflowResumeCoordinator {
  public constructor(private readonly store: WorkflowResumeStore) {}

  public async reconcileAndResume(input: ResumeInput): Promise<ResumeResult> {
    let workItem = await this.store.getWorkItem(input.workItemId);
    if (!workItem.currentAttemptId) {
      return { disposition: 'NOTHING_TO_RESUME', workItem, attempt: null, agentResult: null };
    }

    let attempt = await this.store.getAttempt(workItem.currentAttemptId);
    if (attempt.workItemId !== workItem.id || attempt.projectId !== workItem.projectId) {
      throw new ResumeStateMismatchError('Active attempt does not belong to the persisted WorkItem scope.');
    }
    if (!attempt.agentRunId || !attempt.agentAdapterId) {
      workItem = await this.ensureRecoveryRequired(workItem);
      return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
    }
    if (attempt.agentAdapterId !== input.adapter.identify().adapterId) {
      workItem = await this.ensureRecoveryRequired(workItem);
      return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
    }

    const runRef = { runId: attempt.agentRunId };
    let status: AgentRunStatus;
    try {
      status = await input.adapter.getStatus(runRef);
    } catch {
      workItem = await this.ensureRecoveryRequired(workItem);
      return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
    }

    if (status === 'RUNNING' || status === 'STARTING' || status === 'QUEUED' || status === 'CREATED' || status === 'WAITING_FOR_TOOL') {
      const runtimeContext: AgentRuntimeContext = {
        correlationId: input.correlationId,
        workflowRunId: input.workflowRunId,
        attemptId: attempt.id,
        secretRefs: [],
      };
      const resumed = await input.adapter.resume({ runRef, runtimeContext });
      if (resumed.status !== 'COMPLETED') {
        return { disposition: 'RESUMED_EXISTING_RUN', workItem, attempt, agentResult: null };
      }
      status = resumed.status;
    }

    if (status === 'INTERRUPTED' || status === 'WAITING_FOR_INPUT' || status === 'UNKNOWN') {
      const runtimeContext: AgentRuntimeContext = {
        correlationId: input.correlationId,
        workflowRunId: input.workflowRunId,
        attemptId: attempt.id,
        secretRefs: [],
      };
      try {
        const resumed = await input.adapter.resume({ runRef, runtimeContext });
        status = resumed.status;
      } catch {
        workItem = await this.ensureRecoveryRequired(workItem);
        return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
      }
    }

    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      let result: AgentRunResult;
      try {
        result = await input.adapter.getResult(runRef);
      } catch {
        workItem = await this.ensureRecoveryRequired(workItem);
        return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
      }
      const target = this.mapResult(result.status);
      if (attempt.state !== target.attemptState) {
        attempt = await this.store.transitionAttempt({ attemptId: attempt.id, to: target.attemptState });
      }
      workItem = await this.store.getWorkItem(workItem.id);
      if (workItem.lifecycleState !== target.workItemState) {
        workItem = await this.store.transitionWorkItem({
          workItemId: workItem.id,
          expectedRevision: workItem.revision,
          to: target.workItemState,
        });
      }
      return { disposition: 'RECONCILED_EXISTING_RUN', workItem, attempt, agentResult: result };
    }

    workItem = await this.ensureRecoveryRequired(workItem);
    return { disposition: 'RECOVERY_REQUIRED', workItem, attempt, agentResult: null };
  }

  private async ensureRecoveryRequired(workItem: WorkItem): Promise<WorkItem> {
    if (workItem.lifecycleState === 'RECOVERY_REQUIRED') return workItem;
    return this.store.transitionWorkItem({
      workItemId: workItem.id,
      expectedRevision: workItem.revision,
      to: 'RECOVERY_REQUIRED',
    });
  }

  private mapResult(status: AgentRunResult['status']): { attemptState: AttemptState; workItemState: WorkItemLifecycleState } {
    switch (status) {
      case 'COMPLETED': return { attemptState: 'SUCCEEDED', workItemState: 'VERIFICATION_REQUIRED' };
      case 'FAILED': return { attemptState: 'FAILED', workItemState: 'REPAIR_REQUIRED' };
      case 'INTERRUPTED': return { attemptState: 'INTERRUPTED', workItemState: 'RECOVERY_REQUIRED' };
      case 'CANCELLED': return { attemptState: 'CANCELLED', workItemState: 'RECOVERY_REQUIRED' };
    }
  }
}
