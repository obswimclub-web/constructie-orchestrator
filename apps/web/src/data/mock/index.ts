import { DashboardStats, WorkItem, Agent, Approval, EvidenceEvent, Incident } from '../../types';
import type { ReviewerFinding } from '../../types/agent';
import type { LogEvent } from '../../types/log';
import type { RunDetails } from '../../types/run';
import type { Project, WorkspaceState } from '../../types/project';

// UI-001 uses mock data only.
// No dashboard value is connected to runtime state yet.

export const mockDashboardStats: DashboardStats = {
  activeRuns: 3,
  agentsOnline: 4,
  totalAgents: 4,
  pendingApprovals: 1,
  openIncidents: 0,
  qualificationStatus: 'Qualified',
  governanceState: 'Compliant'
};

export const mockRuns: WorkItem[] = [
  { id: 'run-1', title: 'UI-001 — Owner Dashboard', status: 'RUNNING', startedAt: '10m ago' },
  { id: 'run-2', title: 'Issue #3 Rehydration', status: 'WAITING', startedAt: '1h ago' },
  { id: 'run-3', title: 'Provider Integration', status: 'REPAIR', startedAt: '2h ago' },
  { id: 'run-4', title: 'Reviewer Verification', status: 'REVIEW', startedAt: '3h ago' },
  { id: 'run-5', title: 'CI Qualification', status: 'COMPLETE', startedAt: '1d ago' },
];

export const mockAgents: Agent[] = [
  { id: 'ag-1', name: 'Orchestrator', provider: 'ChatGPT', role: 'Coordinator', status: 'RUNNING', currentTask: 'Dispatching UI-001', latencyMs: 240 },
  { id: 'ag-2', name: 'Antigravity', provider: 'Gemini', role: 'Implementer', status: 'RUNNING', currentTask: 'Building components', latencyMs: 850 },
  { id: 'ag-3', name: 'Codex', provider: 'OpenAI', role: 'Code generation', status: 'IDLE', latencyMs: 120 },
  { id: 'ag-4', name: 'Independent Reviewer', provider: 'Claude', role: 'Verification', status: 'REVIEWING', currentTask: 'Checking security bounds', latencyMs: 450 },
];

export const mockApprovals: Approval[] = [
  {
    id: 'app-1',
    title: 'COMMIT AUTHORIZATION REQUIRED',
    workPackage: 'UI-001 — Owner Dashboard',
    qualificationStatus: 'PASS',
    reviewerStatus: 'PASS',
    securityStatus: 'PASS',
    candidateFiles: 12,
    requestedAt: '5m ago'
  }
];

export const mockEvidence: EvidenceEvent[] = [
  { id: 'ev-1', timestamp: '2 mins ago', actor: 'Independent Reviewer', type: 'VERIFICATION', status: 'SUCCESS', description: 'Independent review passed' },
  { id: 'ev-2', timestamp: '15 mins ago', actor: 'CI System', type: 'QUALIFICATION', status: 'SUCCESS', description: 'Qualification passed' },
  { id: 'ev-3', timestamp: '1 hr ago', actor: 'Antigravity', type: 'EXECUTION', status: 'SUCCESS', description: 'Agent execution completed' },
  { id: 'ev-4', timestamp: '2 hrs ago', actor: 'Orchestrator', type: 'WORKFLOW', status: 'INFO', description: 'Evidence package created' },
  { id: 'ev-5', timestamp: '1 day ago', actor: 'Owner', type: 'GOVERNANCE', status: 'WARNING', description: 'Owner approval requested' },
];

export const mockIncidents: Incident[] = []; // Default state: no critical incidents



export const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Constructie Orchestrator',
    status: 'ACTIVE',
    repository: 'obswimclub-web/constructie-orchestrator',
    branch: 'main',
    currentWorkPackage: 'UI-002 Projects & Workspace',
    lastRun: '2 mins ago',
    health: 'HEALTHY',
    openApprovals: 1,
    openIncidents: 0,
    qualificationState: 'PASS'
  },
  {
    id: 'proj-2',
    name: 'Legacy API Proxy',
    status: 'MAINTENANCE',
    repository: 'obswimclub/legacy-api',
    branch: 'stable',
    currentWorkPackage: null,
    lastRun: '2 days ago',
    health: 'DEGRADED',
    openApprovals: 0,
    openIncidents: 2,
    qualificationState: 'FAIL'
  }
];

export const mockWorkspaceState: WorkspaceState = {
  projectId: 'proj-1',
  header: {
    name: 'Constructie Orchestrator',
    description: 'Enterprise AI coding agent control plane'
  },
  objective: {
    title: 'OVERNIGHT AUTONOMOUS EXECUTION',
    description: 'Implement UI surface layer and verify independently.',
    state: 'IN_PROGRESS'
  },
  activeWorkPackage: 'P1 — UI-002 PROJECTS + PROJECT WORKSPACE',
  timeline: [
    { id: 't1', time: '16:00', title: 'P0 - Verify UI State', status: 'DONE', type: 'TASK' },
    { id: 't2', time: '16:45', title: 'P1 - UI-002 Implementation', status: 'ACTIVE', type: 'TASK' },
    { id: 't3', time: '17:30', title: 'Independent Review', status: 'PENDING', type: 'REVIEW' },
    { id: 't4', time: '18:00', title: 'Owner Commit Gate', status: 'PENDING', type: 'GATE' }
  ]
};



export const mockRunDetails: RunDetails[] = [
  {
    id: 'run-1',
    title: 'UI-001 — Owner Dashboard',
    status: 'RUNNING',
    startedAt: '10m ago',
    duration: '-',
    currentAgent: 'Antigravity',
    reviewer: 'Claude',
    evidenceState: 'PENDING',
    approvalState: 'NOT_REQUIRED'
  },
  {
    id: 'run-2',
    title: 'Issue #3 Rehydration',
    status: 'WAITING',
    startedAt: '1h ago',
    duration: '45m',
    currentAgent: 'Orchestrator',
    reviewer: 'Independent Reviewer',
    evidenceState: 'SECURED',
    approvalState: 'PENDING'
  },
  {
    id: 'run-3',
    title: 'Provider Integration',
    status: 'REPAIR',
    startedAt: '2h ago',
    duration: '1h 10m',
    currentAgent: 'Codex',
    reviewer: 'Claude',
    evidenceState: 'FAILED',
    approvalState: 'NOT_REQUIRED'
  },
  {
    id: 'run-4',
    title: 'Reviewer Verification',
    status: 'REVIEW',
    startedAt: '3h ago',
    duration: '2h 5m',
    currentAgent: 'Claude',
    reviewer: 'Self',
    evidenceState: 'PENDING',
    approvalState: 'NOT_REQUIRED'
  },
  {
    id: 'run-5',
    title: 'CI Qualification',
    status: 'COMPLETE',
    startedAt: '1d ago',
    duration: '12m',
    currentAgent: 'System',
    reviewer: 'Automated',
    evidenceState: 'SECURED',
    approvalState: 'APPROVED'
  }
];

// NOTE: The findings below are fictional mock examples only.
// They do NOT represent the actual current security state of this project.
export const mockFindings: ReviewerFinding[] = [
  {
    id: 'find-1',
    severity: 'CRITICAL',
    criteria: '[MOCK] No secrets in source code',
    evidence: '[MOCK EXAMPLE] Hypothetical token pattern detected in example-config.sample',
    verdict: 'FAIL',
    repaired: true
  },
  {
    id: 'find-2',
    severity: 'HIGH',
    criteria: '[MOCK] Test coverage maintained',
    evidence: '[MOCK EXAMPLE] Hypothetical coverage regression from sample baseline',
    verdict: 'FAIL',
    repaired: false
  },
  {
    id: 'find-3',
    severity: 'MEDIUM',
    criteria: '[MOCK] Mock data isolated from runtime',
    evidence: '[MOCK EXAMPLE] Verified: no runtime variables referenced in mock layer',
    verdict: 'PASS',
    repaired: false
  }
];



export const mockLogs: LogEvent[] = [
  { id: 'log-1', timestamp: '2026-08-31T16:00:00Z', actor: 'System', operation: 'BOOT', status: 'INFO', message: 'Orchestrator online' },
  { id: 'log-2', timestamp: '2026-08-31T16:01:12Z', actor: 'Antigravity', operation: 'BUILD', status: 'SUCCESS', message: 'Compiled components successfully' },
  { id: 'log-3', timestamp: '2026-08-31T16:05:20Z', actor: 'Reviewer', operation: 'VERIFY', status: 'ERROR', message: 'Missing Prisma schema' },
  { id: 'log-4', timestamp: '2026-08-31T16:10:00Z', actor: 'Antigravity', operation: 'REPAIR', status: 'SUCCESS', message: 'Generated Prisma client' }
];
