import { RunStatus } from './index';

export interface RunDetails {
  id: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  duration: string;
  currentAgent: string;
  reviewer: string;
  evidenceState: 'SECURED' | 'PENDING' | 'FAILED';
  approvalState: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_REQUIRED';
}
