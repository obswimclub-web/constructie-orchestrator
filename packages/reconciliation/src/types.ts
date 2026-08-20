export const RECONCILIATION_STATES = ['PASS', 'BLOCKED', 'FAILED', 'UNKNOWN'] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export interface ReconciliationSnapshot {
  readonly state: ReconciliationState;
  readonly projectId: string;
  readonly evaluatedProjectRevision: number;
  readonly evaluatedWorkItemId: string;
  readonly evaluatedWorkItemRevision: number;
  readonly evidenceIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly conflictCodes: readonly string[];
  readonly evaluatedAt: Date;
  readonly ref: string;
}
