import { randomUUID } from 'node:crypto';
import type { Project, WorkItem } from '@co/domain';
import type { EvidenceRecord, VerificationRecord } from '@co/evidence';
import type { ReconciliationSnapshot } from '@co/reconciliation';
import type { CompletionDecision } from './types.js';

export interface CompletionStore {
  saveDecision(decision: CompletionDecision): Promise<CompletionDecision>;
}

export interface CompletionEvaluationInput {
  readonly project: Project;
  readonly workItem: WorkItem;
  readonly completionObjectRef: string;
  readonly verifications: readonly VerificationRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly reconciliation: ReconciliationSnapshot;
  readonly now?: Date;
}

export class CompletionEngineV0 {
  public constructor(private readonly store: CompletionStore) {}

  public async evaluate(input: CompletionEvaluationInput): Promise<CompletionDecision> {
    const now = input.now ?? new Date();
    const rationaleCodes: string[] = [];
    let state: CompletionDecision['state'] = 'INCOMPLETE';

    if (input.workItem.projectId !== input.project.id) {
      throw new Error('Completion evaluation scope mismatch: WorkItem does not belong to Project.');
    }

    if (
      input.reconciliation.projectId !== input.project.id ||
      input.reconciliation.evaluatedProjectRevision !== input.project.revision ||
      input.reconciliation.evaluatedWorkItemId !== input.workItem.id ||
      input.reconciliation.evaluatedWorkItemRevision !== input.workItem.revision
    ) {
      rationaleCodes.push('RECONCILIATION_STALE_OR_SCOPE_MISMATCH');
      state = 'RECONCILIATION_FAILED';
      return this.persist(input, state, rationaleCodes, [], [], now);
    }

    if (input.reconciliation.state === 'BLOCKED') {
      rationaleCodes.push('RECONCILIATION_BLOCKED');
      state = 'BLOCKED';
      return this.persist(input, state, rationaleCodes, [], [], now);
    }
    if (input.reconciliation.state !== 'PASS') {
      rationaleCodes.push('RECONCILIATION_NOT_PASS');
      state = 'RECONCILIATION_FAILED';
      return this.persist(input, state, rationaleCodes, [], [], now);
    }

    if (input.workItem.lifecycleState !== 'COMPLETED') {
      rationaleCodes.push('WORK_ITEM_NOT_COMPLETED');
      state = 'INCOMPLETE';
      return this.persist(input, state, rationaleCodes, [], [], now);
    }

    const passingVerifications = input.verifications.filter(
      (verification) =>
        verification.projectId === input.project.id &&
        verification.workItemId === input.workItem.id &&
        verification.status === 'PASS',
    );

    const currentEvidence = input.evidence.filter(
      (evidence) =>
        evidence.projectId === input.project.id &&
        evidence.workItemId === input.workItem.id &&
        evidence.currentness === 'CURRENT',
    );

    const supportedEvidenceIds = new Set(currentEvidence.map((record) => record.id));
    const validVerifications = passingVerifications.filter(
      (verification) =>
        verification.evidenceIds.length > 0 &&
        verification.evidenceIds.every((evidenceId) => supportedEvidenceIds.has(evidenceId)),
    );

    if (validVerifications.length === 0) {
      rationaleCodes.push('CURRENT_PASS_VERIFICATION_MISSING');
      state = 'EVIDENCE_INSUFFICIENT';
      return this.persist(input, state, rationaleCodes, [], currentEvidence.map((e) => e.id), now);
    }

    rationaleCodes.push('WORK_ITEM_COMPLETED');
    rationaleCodes.push('CURRENT_EVIDENCE_PRESENT');
    rationaleCodes.push('PASS_VERIFICATION_PRESENT');
    rationaleCodes.push('RECONCILIATION_PASS');
    state = 'COMPLETE';

    return this.persist(
      input,
      state,
      rationaleCodes,
      validVerifications.map((v) => v.id),
      currentEvidence.map((e) => e.id),
      now,
    );
  }

  private persist(
    input: CompletionEvaluationInput,
    state: CompletionDecision['state'],
    rationaleCodes: readonly string[],
    verificationIds: readonly string[],
    evidenceIds: readonly string[],
    now: Date,
  ): Promise<CompletionDecision> {
    return this.store.saveDecision({
      id: randomUUID(),
      projectId: input.project.id,
      completionObjectRef: input.completionObjectRef,
      state,
      evaluatedProjectRevision: input.project.revision,
      evaluatedWorkItemId: input.workItem.id,
      evaluatedWorkItemRevision: input.workItem.revision,
      verificationIds,
      evidenceIds,
      reconciliationRef: input.reconciliation.ref,
      rationaleCodes,
      decidedAt: now,
    });
  }
}
