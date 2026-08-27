import type { AgentRunResult, WorkPackage } from './index.js';

export type ReviewDecision = 'PASS' | 'FAIL' | 'NEEDS_EVIDENCE' | 'NEEDS_CONTEXT' | 'OWNER_REQUIRED' | 'BLOCKED' | 'AMBIGUOUS_SIDE_EFFECT';

export interface ReviewVerdict {
  decision: ReviewDecision;
  findings: string[];
  repairObjectives?: string[];
  evidenceRefs: string[];
  pendingGate?: string;
  pendingAction?: string;
  pendingAuthorityType?: string;
}

export interface ReviewRequest {
  workPackage: WorkPackage;
  candidateResult: AgentRunResult;
  executorAgentId: string;
  authoritativeContext: Record<string, unknown>;
  availableEvidence: Record<string, unknown>[];
}

export interface ReviewerBridge {
  readonly reviewerAgentId: string;
  evaluate(request: ReviewRequest): Promise<ReviewVerdict>;
}
