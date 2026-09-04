import type {
  AgentAdapter,
  AgentCancelRequest,
  AgentCancelResult,
  AgentResumeRequest,
  AgentRunHandle,
  AgentRunRef,
  AgentRunStatus,
  AgentRuntimeContext,
  AgentUsage,
  ArtifactRef,
  CapabilityProfile,
  EvidenceRef,
  WorkPackage,
  AdapterHealth
} from '@co/contracts';
import type { AntigravityPythonBridge } from './antigravity-python-bridge.js';

export class AntigravityAdapter implements AgentAdapter {
  constructor(private readonly bridge: AntigravityPythonBridge) {}

  async capabilities(): Promise<CapabilityProfile> {
    return {
      capabilities: {
        code_generation: 'SUPPORTED',
        resumable_session: 'NOT_SUPPORTED', // Python bridge script doesn't support resuming session natively
        timeout: 'SUPPORTED',
        cancellation: 'SUPPORTED',
        outage_handling: 'SUPPORTED',
        malformed_output: 'SUPPORTED',
        rate_limit_handling: 'NOT_SUPPORTED', // 429 not natively translated to INTERRUPTED by the bridge yet
        retry: 'NOT_SUPPORTED'
      },
    };
  }

  async health(): Promise<AdapterHealth> {
    const isHealthy = await this.bridge.healthCheck();
    return isHealthy ? 'AVAILABLE' : 'UNAVAILABLE';
  }

  async execute(
    workPackage: WorkPackage,
    runtimeContext: AgentRuntimeContext,
  ): Promise<AgentRunHandle> {
    return this.bridge.dispatch(workPackage, runtimeContext);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resume(_resumeRequest: AgentResumeRequest): Promise<AgentRunHandle> {
    throw new Error('UNSUPPORTED: Antigravity Python bridge cannot genuinely resume a terminated execution session.');
  }

  async cancel(request: AgentCancelRequest): Promise<AgentCancelResult> {
    await this.bridge.cancel(request.runRef);
    return { runRef: request.runRef, status: 'CANCELLED' };
  }

  async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> {
    return this.bridge.getStatus(runRef);
  }

  async getArtifacts(runRef: AgentRunRef): Promise<ArtifactRef[]> {
    const result = await this.bridge.getResult(runRef);
    return result.artifacts;
  }

  async getEvidence(runRef: AgentRunRef): Promise<EvidenceRef[]> {
    const result = await this.bridge.getResult(runRef);
    return result.evidence;
  }

  async getUsage(runRef: AgentRunRef): Promise<AgentUsage> {
    const result = await this.bridge.getResult(runRef);
    return result.usage;
  }
}
