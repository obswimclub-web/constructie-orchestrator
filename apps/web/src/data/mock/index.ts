import { DashboardStats, WorkItem, Agent, Approval, EvidenceEvent, Incident } from '../../types';

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
