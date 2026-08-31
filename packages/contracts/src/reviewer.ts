export interface ReviewRequest {
  projectId: string;
  workflowRunId: string;
  workPackageId: string;
  attemptId: string;
  
  scopeRevision: string;
  contractRevision: string;
  mocRevision: string;
  
  artifactHashes: Record<string, string>;
  authoritySnapshot: Record<string, unknown>;
  
  requirementRefs: string[];
  evidenceRefs: string[];
  verificationRefs: string[];
  
  ledgerRevision: number;
}

export interface RepairPackage {
  findingId: string;
  requirementRef: string;
  observedEvidence: string;
  allowedScope: string[];
  forbiddenActions: string[];
  requiredVerification: string[];
  requiredEvidence: string[];
  reReviewTrigger: string;
}

export interface ReviewVerdict {
  decision: 'PASS' | 'FAIL_REPAIRABLE' | 'OWNER_DECISION_REQUIRED' | 'AMBIGUOUS_SIDE_EFFECT' | 'BLOCKED' | 'COMPLETE' | 'NEEDS_EVIDENCE';
  findings: string[];
  repairPackage?: RepairPackage;
  reviewDepth: string;
  lineage: string[];
  pendingAction?: string;
  pendingGate?: string;
  pendingAuthorityType?: string;
  nextAction?: string;
}

export interface ReviewerAdapter {
  evaluate(request: ReviewRequest, candidateResult: unknown): Promise<ReviewVerdict>;
}
