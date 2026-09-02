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

