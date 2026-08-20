import { randomUUID } from 'node:crypto';
import type { Project, WorkItem } from '@co/domain';
import type { EvidenceRecord, VerificationRecord } from '@co/evidence';
import type { ReconciliationSnapshot, ReconciliationState } from './types.js';

export interface ReconciliationInput {
  readonly project: Project;
  readonly workItem: WorkItem;
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly now?: Date;
}

export class ReconciliationEngineV0 {
  public reconcile(input: ReconciliationInput): ReconciliationSnapshot {
    const now = input.now ?? new Date();
    const conflicts: string[] = [];

    if (input.workItem.projectId !== input.project.id) {
      conflicts.push('WORK_ITEM_PROJECT_SCOPE_MISMATCH');
      return this.snapshot(input, 'FAILED', conflicts, [], [], now);
    }

    const scopedEvidence = input.evidence.filter(
      (record) => record.projectId === input.project.id && record.workItemId === input.workItem.id,
    );
    const scopedVerifications = input.verifications.filter(
      (record) => record.projectId === input.project.id && record.workItemId === input.workItem.id,
    );

    if (scopedEvidence.length !== input.evidence.length) conflicts.push('CROSS_SCOPE_EVIDENCE_PRESENT');
    if (scopedVerifications.length !== input.verifications.length) conflicts.push('CROSS_SCOPE_VERIFICATION_PRESENT');

    const currentEvidence = scopedEvidence.filter((record) => record.currentness === 'CURRENT');
    const staleEvidence = scopedEvidence.filter((record) => record.currentness !== 'CURRENT');
    if (staleEvidence.length > 0) conflicts.push('STALE_OR_INVALIDATED_EVIDENCE_PRESENT');

    const evidenceById = new Map(scopedEvidence.map((record) => [record.id, record]));
    const passVerifications = scopedVerifications.filter((record) => record.status === 'PASS');
    const failedVerifications = scopedVerifications.filter((record) => record.status === 'FAIL');
    const inconclusiveVerifications = scopedVerifications.filter((record) => record.status === 'INCONCLUSIVE');

    for (const verification of passVerifications) {
      if (verification.evidenceIds.length === 0) {
        conflicts.push('PASS_VERIFICATION_WITHOUT_EVIDENCE');
        continue;
      }
      for (const evidenceId of verification.evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence) conflicts.push('VERIFICATION_REFERENCES_MISSING_EVIDENCE');
        else if (evidence.currentness !== 'CURRENT') conflicts.push('VERIFICATION_REFERENCES_NONCURRENT_EVIDENCE');
      }
    }

    if (failedVerifications.length > 0) conflicts.push('FAILED_VERIFICATION_PRESENT');
    if (inconclusiveVerifications.length > 0) conflicts.push('INCONCLUSIVE_VERIFICATION_PRESENT');

    let state: ReconciliationState = 'PASS';
    if (failedVerifications.length > 0 || conflicts.some((code) => code.includes('MISMATCH') || code.includes('MISSING'))) {
      state = 'FAILED';
    } else if (inconclusiveVerifications.length > 0) {
      state = 'UNKNOWN';
    } else if (input.workItem.lifecycleState !== 'COMPLETED') {
      state = 'BLOCKED';
      conflicts.push('WORK_ITEM_NOT_COMPLETED');
    } else if (passVerifications.length === 0 || currentEvidence.length === 0) {
      state = 'BLOCKED';
      conflicts.push('COMPLETION_SUPPORT_INSUFFICIENT');
    } else if (conflicts.length > 0) {
      state = 'FAILED';
    }

    return this.snapshot(
      input,
      state,
      [...new Set(conflicts)],
      currentEvidence.map((record) => record.id),
      passVerifications.map((record) => record.id),
      now,
    );
  }

  private snapshot(
    input: ReconciliationInput,
    state: ReconciliationState,
    conflictCodes: readonly string[],
    evidenceIds: readonly string[],
    verificationIds: readonly string[],
    now: Date,
  ): ReconciliationSnapshot {
    return {
      state,
      projectId: input.project.id,
      evaluatedProjectRevision: input.project.revision,
      evaluatedWorkItemId: input.workItem.id,
      evaluatedWorkItemRevision: input.workItem.revision,
      evidenceIds,
      verificationIds,
      conflictCodes,
      evaluatedAt: now,
      ref: `reconciliation://${input.project.id}/${input.workItem.id}/${randomUUID()}`,
    };
  }
}
