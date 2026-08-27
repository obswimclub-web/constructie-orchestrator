export const COMPLETION_STATES = [
  'COMPLETE',
  'INCOMPLETE',
  'BLOCKED',
  'EVIDENCE_INSUFFICIENT',
  'RECONCILIATION_FAILED',
] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

export interface ResidualScopeItem {
  readonly id: string;
  readonly description: string;
  readonly type: 'UNRESOLVED_FINDING' | 'UNHANDLED_SIDE_EFFECT' | 'FAILED_VERIFICATION' | 'MISSING_EVIDENCE';
}

export interface CompletionDecision {
  readonly id: string;
  readonly projectId: string;
  readonly completionObjectRef: string;
  readonly state: CompletionState;
  readonly evaluatedProjectRevision: number;
  readonly evaluatedWorkItemId: string;
  readonly evaluatedWorkItemRevision: number;
  readonly verificationIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly reconciliationRef: string;
  readonly rationaleCodes: readonly string[];
  readonly residualScope: readonly ResidualScopeItem[];
  readonly decidedAt: Date;
}
