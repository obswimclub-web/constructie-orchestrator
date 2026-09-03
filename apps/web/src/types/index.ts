export type RunStatus = 'RUNNING' | 'REVIEW' | 'REPAIR' | 'WAITING' | 'COMPLETE';
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AgentStatus = 'ONLINE' | 'RUNNING' | 'IDLE' | 'REVIEWING';

export interface DashboardStats {
  activeRuns: number;
  agentsOnline: number;
  totalAgents: number;
  pendingApprovals: number;
  openIncidents: number;
  qualificationStatus: string;
  governanceState: string;
}

export interface WorkItem {
  id: string;
  title: string;
  status: RunStatus;
  startedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  provider: string;
  role: string;
  status: AgentStatus;
  currentTask?: string;
  latencyMs: number;
}

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

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED';

export interface Approval {
  id: string;
  projectId: string;
  workItemId: string | null;
  gateKind: string;
  status: ApprovalStatus;
  scope: Record<string, unknown>;
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

export interface EvidenceEvent {
  id: string;
  timestamp: string;
  actor: string;
  type: string;
  status: 'SUCCESS' | 'WARNING' | 'ERROR' | 'INFO';
  description: string;
}

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  title: string;
  runId: string;
  age: string;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
}
export * from './project';
export * from './run';
export * from './agent';
export * from './log';
