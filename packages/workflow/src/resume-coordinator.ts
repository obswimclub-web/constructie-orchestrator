import type { AgentAdapter, AgentRunResult, AgentRunStatus, AgentRuntimeContext, WorkPackage } from '@co/contracts';
import type { Attempt, AttemptState, WorkItem, WorkItemLifecycleState } from '@co/domain';

export interface ResumeWorkStore {
  transitionAttempt(input: { attemptId: string; to: AttemptState }): Promise<Attempt>;
  transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }): Promise<WorkItem>;
}

export interface ResumeWorkItemInput {
  readonly workItem: WorkItem;
  readonly attempt: Attempt;
  readonly workPackage: WorkPackage;
  readonly adapter: AgentAdapter;
  readonly correlationId: string;
  readonly workflowRunId: string;
}

export interface ResumeExecutionResult {
  readonly workItem: WorkItem;
  readonly attempt: Attempt;
  readonly agentResult: AgentRunResult | null;
}

export class ResumeCoordinator {
  public constructor(private readonly store: ResumeWorkStore) {}

  public async resume(input: ResumeWorkItemInput): Promise<ResumeExecutionResult> {
    if (!input.attempt.agentRunId) {
      throw new Error(`Attempt ${input.attempt.id} has no agentRunId`);
    }

    const runtimeContext: AgentRuntimeContext = {
      correlationId: input.correlationId,
      workflowRunId: input.workflowRunId,
      attemptId: input.attempt.id,
      secretRefs: [],
    };

    let runStatus: AgentRunStatus;
    try {
      const run = await input.adapter.resume({
        runRef: { runId: input.attempt.agentRunId },
        runtimeContext,
      });
      runStatus = run.status;
    } catch {
      const failedAttempt = await this.store.transitionAttempt({ attemptId: input.attempt.id, to: 'FAILED' });
      const workItem = await this.store.transitionWorkItem({
        workItemId: input.workItem.id,
        expectedRevision: input.workItem.revision,
        to: 'RECOVERY_REQUIRED',
      });
      return { workItem, attempt: failedAttempt, agentResult: null };
    }

    if (runStatus === 'WAITING_FOR_INPUT' || runStatus === 'WAITING_FOR_TOOL' || runStatus === 'INTERRUPTED') {
      const interruptedAttempt = await this.store.transitionAttempt({ attemptId: input.attempt.id, to: 'INTERRUPTED' });
      const workItem = await this.store.transitionWorkItem({
        workItemId: input.workItem.id,
        expectedRevision: input.workItem.revision,
        to: 'WAITING',
      });
      return { workItem, attempt: interruptedAttempt, agentResult: null };
    }

    let result: AgentRunResult;
    try {
      const runRef = { runId: input.attempt.agentRunId };
      const status = await input.adapter.getStatus(runRef);
      const artifacts = await input.adapter.getArtifacts(runRef);
      const evidence = await input.adapter.getEvidence(runRef);
      const usage = await input.adapter.getUsage(runRef);

      result = {
        schemaVersion: '1.0.0',
        runRef,
        status: status as AgentRunResult['status'],
        summary: 'Resume completed',
        artifacts,
        evidence,
        usage,
        actionsTaken: [],
        findings: [],
        unresolvedItems: [],
        requestedInputs: [],
        sideEffects: [],
      };
    } catch {
      const failedAttempt = await this.store.transitionAttempt({ attemptId: input.attempt.id, to: 'FAILED' });
      const workItem = await this.store.transitionWorkItem({
        workItemId: input.workItem.id,
        expectedRevision: input.workItem.revision,
        to: 'RECOVERY_REQUIRED',
      });
      return { workItem, attempt: failedAttempt, agentResult: null };
    }

    const target = this.mapResult(result.status);
    const finalAttempt = await this.store.transitionAttempt({ attemptId: input.attempt.id, to: target.attemptState });
    const workItem = await this.store.transitionWorkItem({
      workItemId: input.workItem.id,
      expectedRevision: input.workItem.revision,
      to: target.workItemState,
    });

    return { workItem, attempt: finalAttempt, agentResult: result };
  }

  private mapResult(status: AgentRunResult['status']): { attemptState: AttemptState; workItemState: WorkItemLifecycleState } {
    switch (status) {
      case 'COMPLETED': return { attemptState: 'SUCCEEDED', workItemState: 'VERIFICATION_REQUIRED' };
      case 'FAILED': return { attemptState: 'FAILED', workItemState: 'REPAIR_REQUIRED' };
      case 'INTERRUPTED': return { attemptState: 'INTERRUPTED', workItemState: 'RECOVERY_REQUIRED' };
      case 'CANCELLED': return { attemptState: 'CANCELLED', workItemState: 'RECOVERY_REQUIRED' };
      default: return { attemptState: 'FAILED', workItemState: 'REPAIR_REQUIRED' };
    }
  }
}
