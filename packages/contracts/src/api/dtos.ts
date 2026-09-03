export interface ProjectDto {
  id: string;
  slug: string;
  name: string;
  lifecycleState: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemDto {
  id: string;
  projectId: string;
  parentId: string | null;
  type: string;
  objective: string;
  lifecycleState: string;
  revision: number;
  currentAttemptId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptDto {
  id: string;
  projectId: string;
  workItemId: string;
  attemptNumber: number;
  state: string;
  active: boolean;
  workPackageVersion: number;
  agentRunId: string | null;
  agentAdapterId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRecordDto {
  id: string;
  projectId: string;
  workItemId: string;
  artifactId: string | null;
  claim: string;
  sourceType: string;
  sourceRef: string;
  currentness: string;
  observedAt: string;
  createdAt: string;
}

// ─── Approval Authority Types ─────────────────────────────────────────────────

export type ApprovalGateKind = 'COMMIT' | 'PUSH' | 'DEPLOY' | 'CUSTOM';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED';

export interface ApprovalScopeCommit {
  kind: 'COMMIT';
  paths: string[];
  message: string;
  candidateSha?: string;
}

export interface ApprovalScopePush {
  kind: 'PUSH';
  commitSha: string;
  remote: string;
  branch: string;
}

export type ApprovalScope = ApprovalScopeCommit | ApprovalScopePush | Record<string, unknown>;

export interface ApprovalEvidenceRef {
  id: string;
  claim: string;
  sourceRef: string;
}

export interface ApprovalPostActionVerification {
  result: 'PASS' | 'FAIL' | 'PENDING';
  verifiedAt: string;
  sha?: string;
  remoteRef?: string;
  details?: string;
}

export interface ApprovalDto {
  id: string;
  projectId: string;
  workItemId: string | null;
  attemptId: string | null;
  gateKind: ApprovalGateKind;
  status: ApprovalStatus;
  scope: ApprovalScope;
  evidenceRefs: ApprovalEvidenceRef[];
  requestedBy: string;
  requestedAt: string;
  expiresAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rationale: string | null;
  consumedAt: string | null;
  postActionVerification: ApprovalPostActionVerification | null;
}

export interface ApprovalDecisionDto {
  decision: 'APPROVED' | 'REJECTED';
  rationale?: string;
  decidedBy?: string;
}

export interface CreateApprovalDto {
  projectId: string;
  workItemId?: string;
  attemptId?: string;
  gateKind: ApprovalGateKind;
  scope: ApprovalScope;
  evidenceRefs: ApprovalEvidenceRef[];
  requestedBy?: string;
  expiresAt?: string;
}

export interface ApprovalConsumeDto {
  gateKind: ApprovalGateKind;
  scope: ApprovalScope;
  executorRef?: string;
}
