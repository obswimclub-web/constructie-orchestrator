import { ProjectDto, WorkItemDto, AttemptDto, EvidenceRecordDto, ApprovalDto, ApprovalDecisionDto, CreateApprovalDto, ApprovalConsumeDto } from '@co/contracts';
import { Project, WorkItem, Approval, EvidenceEvent, RunStatus } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';




export async function checkSession(): Promise<{ authenticated: boolean; projectBound: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/auth/session`, { credentials: 'include' });
    if (!res.ok) return { authenticated: false, projectBound: false };
    return await res.json();
  } catch {
    return { authenticated: false, projectBound: false };
  }
}

export async function loginWithBootstrap(bootstrapKey: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootstrapKey }),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Invalid bootstrap key');
}

export async function logoutOwner(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

async function authenticatedFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    }
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('co-auth-unauthorized'));
  }
  return res;
}




export async function fetchProjects(): Promise<Project[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/projects`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  const dtos: ProjectDto[] = await res.json();

  return dtos.map(dto => ({
    id: dto.id,
    name: dto.name,
    status: dto.lifecycleState as Project['status'],
    repository: dto.slug,
    branch: 'main',
    currentWorkPackage: null,
    lastRun: dto.updatedAt,
    health: 'HEALTHY',
    openApprovals: 0,
    openIncidents: 0,
    qualificationState: 'UNKNOWN'
  }));
}

function mapLifecycleStateToRunStatus(state: string): RunStatus {
  switch (state) {
    case 'RUNNING': return 'RUNNING';
    case 'REVIEW_REQUIRED': return 'REVIEW';
    case 'REPAIR_REQUIRED': return 'REPAIR';
    case 'WAITING': return 'WAITING';
    case 'COMPLETED': return 'COMPLETE';
    default: return 'WAITING';
  }
}

export async function fetchWorkItems(): Promise<WorkItem[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/work-items`);
  if (!res.ok) throw new Error('Failed to fetch work items');
  const dtos: WorkItemDto[] = await res.json();

  return dtos.map(dto => ({
    id: dto.id,
    title: dto.objective,
    status: mapLifecycleStateToRunStatus(dto.lifecycleState),
    startedAt: dto.createdAt
  }));
}

export async function fetchAttempts(): Promise<AttemptDto[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/attempts`);
  if (!res.ok) throw new Error('Failed to fetch attempts');
  return res.json();
}

export async function fetchEvidence(): Promise<EvidenceEvent[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/evidence`);
  if (!res.ok) throw new Error('Failed to fetch evidence');
  const dtos: EvidenceRecordDto[] = await res.json();

  return dtos.map(dto => ({
    id: dto.id,
    timestamp: dto.observedAt,
    actor: 'System',
    type: dto.sourceType,
    status: 'SUCCESS',
    description: dto.claim
  }));
}

function mapApprovalDtoToFrontend(dto: ApprovalDto): Approval {
  return {
    id: dto.id,
    projectId: dto.projectId,
    workItemId: dto.workItemId,
    gateKind: dto.gateKind,
    status: dto.status,
    scope: dto.scope as Record<string, unknown>,
    evidenceRefs: dto.evidenceRefs,
    requestedBy: dto.requestedBy,
    requestedAt: dto.requestedAt,
    expiresAt: dto.expiresAt,
    decidedBy: dto.decidedBy,
    decidedAt: dto.decidedAt,
    rationale: dto.rationale,
    consumedAt: dto.consumedAt,
    postActionVerification: dto.postActionVerification,
  };
}

export async function fetchApprovals(status = 'PENDING'): Promise<Approval[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/approvals?status=${status}`);
  if (!res.ok) throw new Error('Failed to fetch approvals');
  const dtos: ApprovalDto[] = await res.json();
  return dtos.map(mapApprovalDtoToFrontend);
}

export async function fetchApproval(id: string): Promise<Approval> {
  const res = await authenticatedFetch(`${API_BASE}/api/approvals/${id}`);
  if (!res.ok) throw new Error('Failed to fetch approval');
  const dto: ApprovalDto = await res.json();
  return mapApprovalDtoToFrontend(dto);
}

export async function createApproval(payload: CreateApprovalDto): Promise<Approval> {
  const res = await authenticatedFetch(`${API_BASE}/api/approvals`, {
    method: 'POST',
    
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create approval');
  const dto: ApprovalDto = await res.json();
  return mapApprovalDtoToFrontend(dto);
}

export async function decideApproval(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  rationale?: string,
  decidedBy?: string
): Promise<Approval> {
  const body: ApprovalDecisionDto = { decision, rationale, decidedBy };
  const res = await authenticatedFetch(`${API_BASE}/api/approvals/${id}/decide`, {
    method: 'POST',
    
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to decide on approval');
  }
  const dto: ApprovalDto = await res.json();
  return mapApprovalDtoToFrontend(dto);
}

export async function consumeApproval(id: string, payload: ApprovalConsumeDto): Promise<Approval> {
  const res = await authenticatedFetch(`${API_BASE}/api/approvals/${id}/consume`, {
    method: 'POST',
    
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to consume approval');
  }
  const dto: ApprovalDto = await res.json();
  return mapApprovalDtoToFrontend(dto);
}

export async function fetchDashboardStats() {
  const [runs, approvals] = await Promise.all([
    fetchWorkItems().catch(() => []),
    fetchApprovals().catch(() => []),
  ]);

  return {
    activeRuns: runs.filter(r => r.status === 'RUNNING').length,
    agentsOnline: 0,
    totalAgents: 0,
    pendingApprovals: approvals.length,
    openIncidents: 0,
    qualificationStatus: 'PASSING',
    governanceState: 'SECURE'
  };
}


export interface Agent { id: string; name: string; status: string; role: string; provider: string; latencyMs: number; currentTask: string; }
export interface Incident { id: string; title: string; severity: string; status: string; runId: string; age: string; }
export interface Log { id: string; timestamp: string; actor: string; status: string; operation: string; message: string; }
export interface Finding { id: string; criteria: string; severity: string; verdict: string; repaired: boolean; evidence: string; }
export interface RunDetail { id: string; title: string; startedAt: string; status: string; currentAgent: string; reviewer: string; duration: string; evidenceState: string; approvalState: string; }
export interface WorkspaceState { header: { name: string; description: string; }; activeWorkPackage: string; objective: { title: string; description: string; }; timeline: { id: string; status: string; title: string; description: string; timestamp: string; duration?: string; logs?: string; }[]; }
export type NodeState = 'COMPLETED' | 'CURRENT' | 'WAITING' | 'OWNER_AUTHORITY_GATE' | 'REVIEW';
export interface GraphNode { id: string; label: string; state: NodeState; autonomous?: boolean; }

export async function fetchAgents(): Promise<Agent[]> {
  return [];
}

export async function fetchIncidents(): Promise<Incident[]> {
  return [];
}

export async function fetchLogs(): Promise<Log[]> {
  const res = await authenticatedFetch(`${API_BASE}/api/audit-logs`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  const data = await res.json();
  if (!data || !data.items) return [];
  return data.items.map((item: { id: string, occurredAt: string, actorType?: string, eventType: string, payload?: unknown }) => ({
    id: item.id,
    timestamp: item.occurredAt,
    actor: item.actorType || 'System',
    status: 'SUCCESS',
    operation: item.eventType,
    message: typeof item.payload === 'object' ? JSON.stringify(item.payload) : String(item.payload || 'No details')
  }));
}

export async function fetchFindings(): Promise<Finding[]> {
  return [];
}


export async function fetchRunDetails(): Promise<RunDetail[]> {
  const items = await fetchWorkItems().catch(() => []);
  return items.map(item => ({
    id: item.id,
    title: item.title,
    startedAt: new Date(item.startedAt).toLocaleString(),
    status: item.status,
    currentAgent: 'Orchestrator',
    reviewer: 'Pending',
    duration: '0s',
    evidenceState: 'PENDING',
    approvalState: 'PENDING'
  }));
}


export async function fetchWorkspaceState(): Promise<WorkspaceState> {
  return {
    header: { name: 'Constructie Orchestrator', description: '' },
    activeWorkPackage: 'None',
    objective: { title: 'None', description: 'No active objective' },
    timeline: []
  };
}

export async function fetchTaskGraph(): Promise<GraphNode[]> {
  return [];
}


export async function createProject(name: string, slug: string): Promise<Project> {
  const res = await authenticatedFetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    
    body: JSON.stringify({ name, slug })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create project' }));
    throw new Error(err.error || 'Failed to create project');
  }
  const dto = await res.json();
  return {
    id: dto.id,
    name: dto.name,
    status: dto.lifecycleState as Project['status'],
    repository: dto.slug,
    branch: 'main',
    currentWorkPackage: null,
    lastRun: dto.updatedAt,
    health: 'HEALTHY',
    openApprovals: 0,
    openIncidents: 0,
    qualificationState: 'UNKNOWN'
  };
}

export async function createWorkItem(objective: string): Promise<WorkItem> {
  const res = await authenticatedFetch(`${API_BASE}/api/work-items`, {
    method: 'POST',
    
    body: JSON.stringify({ objective, type: 'TASK' })
  });
  if (!res.ok) throw new Error('Failed to create work item');
  const dto = await res.json();
  return {
    id: dto.id,
    title: dto.objective,
    status: mapLifecycleStateToRunStatus(dto.lifecycleState),
    startedAt: dto.createdAt
  };
}
