import type {
  AgentRunHandle,
  AgentRunRef,
  AgentRunResult,
  AgentRunStatus,
  AgentRuntimeContext,
  WorkPackage,
} from '../agent/contracts.js';

export interface AgentBridge {
  dispatch(workPackage: WorkPackage, context: AgentRuntimeContext): Promise<AgentRunHandle>;
  getStatus(runRef: AgentRunRef): Promise<AgentRunStatus>;
  getResult(runRef: AgentRunRef): Promise<AgentRunResult>;
  cancel(runRef: AgentRunRef): Promise<void>;
}
