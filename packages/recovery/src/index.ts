import type { SealedReconciliationOutcome, RunCoordinator } from '@co/workflow';
import type { TrustedReconciliationIssuer } from '@co/workflow/dist/run-coordinator.js';
import type { ActionRequest } from '@co/policy';

export interface IndependentVerificationContext {
  readonly projectId: string;
  readonly workflowRunId: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface VerificationAgent {
  verifyAmbiguousState(
    failedAction: ActionRequest,
    context: IndependentVerificationContext
  ): Promise<{ safeToRetry: boolean; reason: string }>;
}

export class ReconciliationProcess {
  constructor(
    private readonly issuer: TrustedReconciliationIssuer,
    private readonly verifier: VerificationAgent
  ) {}

  public async reconcile(
    failedAction: ActionRequest,
    context: IndependentVerificationContext
  ): Promise<SealedReconciliationOutcome> {
    const verification = await this.verifier.verifyAmbiguousState(failedAction, context);

    return this.issuer.issueOutcome({
      safeToRetry: verification.safeToRetry,
      correlationId: context.correlationId,
      causationId: context.causationId,
      reason: verification.reason,
    });
  }
}

export class RuntimeRecoveryTrigger {
  constructor(
    private readonly coordinator: RunCoordinator,
    private readonly process: ReconciliationProcess
  ) {}

  /**
   * Called by the orchestrator runtime whenever a run enters RECONCILING state.
   */
  public async handleAmbiguousState(
    failedAction: ActionRequest,
    context: IndependentVerificationContext
  ): Promise<void> {
    const outcome = await this.process.reconcile(failedAction, context);
    await this.coordinator.resumeFromReconciliation(context.workflowRunId, outcome);
  }
}
