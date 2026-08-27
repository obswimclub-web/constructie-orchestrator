import { randomUUID } from 'node:crypto';
import {
  WorkPackageSchema,
  type AgentAdapter,
  type AgentCancelRequest,
  type AgentCancelResult,
  type AgentResumeRequest,
  type AgentRunHandle,
  type AgentRunRef,
  type AgentRunStatus,
  type AgentRuntimeContext,
  type AgentUsage,
  type CapabilityProfile,
  type WorkPackage,
  type ArtifactRef,
  type EvidenceRef,
} from '@co/contracts';

export type MockAgentScenario =
  | 'SUCCESS'
  | 'FAIL'
  | 'TIMEOUT'
  | 'INTERRUPTED'
  | 'WAITING_FOR_INPUT'
  | 'MALFORMED_RESULT';

type StoredRun = {
  scenario: MockAgentScenario;
  status: AgentRunStatus;
  workPackage: WorkPackage;
  artifacts?: ArtifactRef[];
  evidence?: EvidenceRef[];
  usage?: AgentUsage;
};

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

  async capabilities(): Promise<CapabilityProfile> {
    return {
      capabilities: {
        code_generation: 'SUPPORTED',
        code_modification: 'SUPPORTED',
        test_execution: 'SUPPORTED',
        review: 'SUPPORTED',
        resumable_session: 'SUPPORTED',
      },
    };
  }

  async execute(
    workPackage: WorkPackage,
    _runtimeContext: AgentRuntimeContext,
  ): Promise<AgentRunHandle> {
    void _runtimeContext;
    const wp = WorkPackageSchema.parse(workPackage);
    const runId = randomUUID();
    const status = this.initialStatus(this.scenario);

    let artifacts: ArtifactRef[] = [];
    if (this.scenario === 'SUCCESS') {
      artifacts = [
        {
          artifactId: `artifact-${runId}`,
          type: 'PATCH',
          ref: `mock://patch/${runId}`,
        },
      ];
    }

    this.registry.runs.set(runId, {
      scenario: this.scenario,
      status,
      workPackage: Object.freeze(wp),
      artifacts,
      evidence: [],
      usage: {
        inputUnits: 10,
        outputUnits: 5,
        estimatedCost: 0,
        currency: 'USD',
      },
    });
    return { runId, status };
  }

  async resume({ runRef }: AgentResumeRequest): Promise<AgentRunHandle> {
    const run = this.getRun(runRef);
    if (
      run.status === 'INTERRUPTED' ||
      run.status === 'WAITING_FOR_INPUT' ||
      run.status === 'UNKNOWN' ||
      run.status === 'RUNNING' ||
      run.status === 'STARTING' ||
      run.status === 'QUEUED' ||
      run.status === 'CREATED' ||
      run.status === 'WAITING_FOR_TOOL'
    ) {
      run.status = 'COMPLETED';
      run.artifacts = [
        {
          artifactId: `artifact-${runRef.runId}`,
          type: 'PATCH',
          ref: `mock://patch/${runRef.runId}`,
        },
      ];
    }
    return { ...runRef, status: run.status };
  }

  async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> {
    return this.getRun(runRef).status;
  }

  async getArtifacts(runRef: AgentRunRef): Promise<ArtifactRef[]> {
    const run = this.getRun(runRef);
    if (run.scenario === 'MALFORMED_RESULT') {
      throw new AgentResultValidationError('Malformed artifact data');
    }
    return run.artifacts ?? [];
  }

  async getEvidence(runRef: AgentRunRef): Promise<EvidenceRef[]> {
    const run = this.getRun(runRef);
    if (run.scenario === 'MALFORMED_RESULT') {
      throw new AgentResultValidationError('Malformed evidence data');
    }
    return run.evidence ?? [];
  }

  async cancel({ runRef }: AgentCancelRequest): Promise<AgentCancelResult> {
    const run = this.getRun(runRef);
    run.status = 'CANCELLED';
    return { runRef, status: 'CANCELLED' };
  }

  async getUsage(runRef: AgentRunRef): Promise<AgentUsage> {
    return (
      this.getRun(runRef).usage ?? {
        inputUnits: 0,
        outputUnits: 0,
        estimatedCost: 0,
        currency: 'USD',
      }
    );
  }

  private getRun(ref: AgentRunRef): StoredRun {
    const run = this.registry.runs.get(ref.runId);
    if (!run) throw new AgentRunNotFoundError(ref.runId);
    return run;
  }
  private initialStatus(s: MockAgentScenario): AgentRunStatus {
    if (s === 'SUCCESS') return 'COMPLETED';
    if (s === 'FAIL' || s === 'MALFORMED_RESULT') return 'FAILED';
    if (s === 'INTERRUPTED' || s === 'TIMEOUT') return 'INTERRUPTED';
    if (s === 'WAITING_FOR_INPUT') return 'WAITING_FOR_INPUT';
    return 'UNKNOWN';
  }
}
