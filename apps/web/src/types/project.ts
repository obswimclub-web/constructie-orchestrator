export interface Project {
  id: string;
  name: string;
  status: 'ACTIVE' | 'IDLE' | 'MAINTENANCE' | 'ERROR';
  repository: string;
  branch: string;
  currentWorkPackage: string | null;
  lastRun: string;
  health: 'HEALTHY' | 'DEGRADED' | 'FAILING';
  openApprovals: number;
  openIncidents: number;
  qualificationState: 'PASS' | 'FAIL' | 'UNKNOWN';
}

export interface WorkspaceObjective {
  title: string;
  description: string;
  state: 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
}

export interface WorkspaceState {
  projectId: string;
  header: {
    name: string;
    description: string;
  };
  objective: WorkspaceObjective;
  activeWorkPackage: string;
  timeline: Array<{
    id: string;
    time: string;
    title: string;
    status: 'DONE' | 'ACTIVE' | 'PENDING' | 'FAILED';
    type: 'TASK' | 'GATE' | 'REVIEW';
  }>;
}
