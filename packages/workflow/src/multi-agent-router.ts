import type { AgentBridge, WorkPackage, AgentRunHandle, AgentRunResult } from '@co/contracts';
import type { AgentRuntimeContext } from '@co/contracts';

export interface MultiAgentRouterOptions {
  selectBridge: (wp: WorkPackage) => AgentBridge;
}

export class MultiAgentRouter implements AgentBridge {
  private runs = new Map<string, AgentBridge>();

  constructor(private readonly options: MultiAgentRouterOptions) {}

  public async dispatch(workPackage: WorkPackage, context: AgentRuntimeContext): Promise<AgentRunHandle> {
    const bridge = this.options.selectBridge(workPackage);
    const handle = await bridge.dispatch(workPackage, context);
    this.runs.set(handle.runId, bridge);
    return handle;
  }

  public async getStatus(runRef: { runId: string }): Promise<import('@co/contracts').AgentRunStatus> {
    const bridge = this.runs.get(runRef.runId);
    if (!bridge) throw new Error('Unknown run ' + runRef.runId);
    return bridge.getStatus(runRef);
  }

  public async getResult(runRef: { runId: string }): Promise<AgentRunResult> {
    const bridge = this.runs.get(runRef.runId);
    if (!bridge) throw new Error('Unknown run ' + runRef.runId);
    return bridge.getResult(runRef);
  }

  public async cancel(runRef: { runId: string }): Promise<void> {
    const bridge = this.runs.get(runRef.runId);
    if (bridge) {
      await bridge.cancel(runRef);
    }
  }
}
