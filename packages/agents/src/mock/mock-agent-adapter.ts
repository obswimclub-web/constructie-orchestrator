import { randomUUID } from 'node:crypto';
import {
  AGENT_ADAPTER_CONTRACT_VERSION, AGENT_RESULT_SCHEMA_VERSION,
  AgentRunResultSchema, WorkPackageSchema,
  type AdapterHealth, type AgentAdapter, type AgentAdapterIdentity, type AgentCancelRequest,
  type AgentCancelResult, type AgentResumeRequest, type AgentRunHandle, type AgentRunRef,
  type AgentRunResult, type AgentRunStatus, type AgentRuntimeContext, type AgentUsage,
  type CapabilityProfile, type WorkPackage,
} from '@co/contracts';

export type MockAgentScenario = 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'INTERRUPTED' | 'WAITING_FOR_INPUT' | 'MALFORMED_RESULT';

type StoredRun = { scenario: MockAgentScenario; status: AgentRunStatus; workPackage: WorkPackage; result?: unknown };

export class MockAgentRunRegistry {
  public readonly runs = new Map<string, StoredRun>();
}

export class AgentResultValidationError extends Error {}
export class AgentRunNotFoundError extends Error {}

export class MockAgentAdapter implements AgentAdapter {
  constructor(
    private readonly scenario: MockAgentScenario = 'SUCCESS',
    private readonly registry: MockAgentRunRegistry = new MockAgentRunRegistry(),
  ) {}

  identify(): AgentAdapterIdentity {
    return { adapterId: 'mock-agent', provider: 'mock', harness: 'deterministic', adapterVersion: '1.0.0', contractVersionSupported: AGENT_ADAPTER_CONTRACT_VERSION };
  }

  async capabilities(): Promise<CapabilityProfile> {
    return { capabilities: { code_generation: 'SUPPORTED', code_modification: 'SUPPORTED', test_execution: 'SUPPORTED', review: 'SUPPORTED', resumable_session: 'SUPPORTED' } };
  }

  async start(workPackage: WorkPackage, // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _runtimeContext: AgentRuntimeContext): Promise<AgentRunHandle> {
    const wp = WorkPackageSchema.parse(workPackage);
    const runId = randomUUID();
    const status = this.initialStatus(this.scenario);
    this.registry.runs.set(runId, { scenario: this.scenario, status, workPackage: Object.freeze(wp), result: this.buildResult(runId, this.scenario) });
    return { runId, status };
  }

  async resume({ runRef }: AgentResumeRequest): Promise<AgentRunHandle> {
    const run = this.getRun(runRef);
    if (run.status === 'INTERRUPTED' || run.status === 'WAITING_FOR_INPUT' || run.status === 'UNKNOWN' || run.status === 'RUNNING' || run.status === 'STARTING' || run.status === 'QUEUED' || run.status === 'CREATED' || run.status === 'WAITING_FOR_TOOL') {
      run.status = 'COMPLETED';
      run.result = this.result(runRef.runId, 'COMPLETED', 'Mock execution resumed and completed', [{ artifactId: `artifact-${runRef.runId}`, type: 'PATCH', ref: `mock://patch/${runRef.runId}` }]);
    }
    return { ...runRef, status: run.status };
  }

  async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> { return this.getRun(runRef).status; }

  async getResult(runRef: AgentRunRef): Promise<AgentRunResult> {
    const run = this.getRun(runRef);
    const parsed = AgentRunResultSchema.safeParse(run.result);
    if (!parsed.success) throw new AgentResultValidationError(`Invalid agent result for run ${runRef.runId}`);
    return parsed.data;
  }

  async cancel({ runRef }: AgentCancelRequest): Promise<AgentCancelResult> {
    const run = this.getRun(runRef); run.status = 'CANCELLED';
    run.result = this.result(runRef.runId, 'CANCELLED', 'Mock run cancelled');
    return { runRef, status: 'CANCELLED' };
  }

  async getUsage(// eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runRef: AgentRunRef): Promise<AgentUsage> { return { inputUnits: 10, outputUnits: 5, estimatedCost: 0, currency: 'USD' }; }
  async health(): Promise<AdapterHealth> { return 'AVAILABLE'; }

  private getRun(ref: AgentRunRef): StoredRun { const run = this.registry.runs.get(ref.runId); if (!run) throw new AgentRunNotFoundError(ref.runId); return run; }
  private initialStatus(s: MockAgentScenario): AgentRunStatus {
    if (s === 'SUCCESS') return 'COMPLETED'; if (s === 'FAIL' || s === 'MALFORMED_RESULT') return 'FAILED';
    if (s === 'INTERRUPTED' || s === 'TIMEOUT') return 'INTERRUPTED'; if (s === 'WAITING_FOR_INPUT') return 'WAITING_FOR_INPUT'; return 'UNKNOWN';
  }
  private buildResult(runId: string, s: MockAgentScenario): unknown {
    if (s === 'MALFORMED_RESULT') return { runRef: { runId }, status: 'banana' };
    if (s === 'SUCCESS') return this.result(runId, 'COMPLETED', 'Mock execution completed', [{ artifactId: `artifact-${runId}`, type: 'PATCH' as const, ref: `mock://patch/${runId}` }]);
    if (s === 'FAIL') return this.result(runId, 'FAILED', 'Mock execution failed');
    if (s === 'INTERRUPTED' || s === 'TIMEOUT') return this.result(runId, 'INTERRUPTED', 'Mock execution interrupted');
    return this.result(runId, 'INTERRUPTED', 'Mock execution awaits input');
  }
  private result(runId: string, status: 'COMPLETED'|'FAILED'|'CANCELLED'|'INTERRUPTED', summary: string, artifacts: AgentRunResult['artifacts'] = []): AgentRunResult {
    return { schemaVersion: AGENT_RESULT_SCHEMA_VERSION, runRef: { runId }, status, summary, actionsTaken: [], artifacts, findings: [], evidence: [], unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 10, outputUnits: 5, estimatedCost: 0, currency: 'USD' } };
  }
}
