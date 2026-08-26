import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
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
} from '@co/contracts';

type CodexRunState = {
  status: AgentRunStatus;
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];
  usage: AgentUsage;
};

export class CodexAdapter implements AgentAdapter {
  private readonly runs = new Map<string, CodexRunState>();

  constructor(private readonly openaiClientFactory?: (apiKey: string) => any) {}

  async capabilities(): Promise<CapabilityProfile> {
    return {
      capabilities: {
        code_generation: 'SUPPORTED',
        resumable_session: 'SUPPORTED',
      },
    };
  }

  async execute(
    workPackage: WorkPackage,
    runtimeContext: AgentRuntimeContext,
  ): Promise<AgentRunHandle> {
    const runId = randomUUID();

    this.runs.set(runId, {
      status: 'RUNNING',
      artifacts: [],
      evidence: [],
      usage: {
        inputUnits: 0,
        outputUnits: 0,
        estimatedCost: 0,
        currency: 'USD',
      },
    });

    const apiKey = runtimeContext.secretRefs.includes('OPENAI_API_KEY')
      ? process.env.OPENAI_API_KEY
      : undefined;

    if (!apiKey) {
      this.updateState(runId, {
        status: 'FAILED',
        evidence: [
          {
            type: 'error',
            claimSupported: 'Missing API Key',
            sourceRef: 'CodexAdapter',
          },
        ],
      });
      return { runId, status: 'FAILED' };
    }

    const openai = this.openaiClientFactory
      ? this.openaiClientFactory(apiKey)
      : new OpenAI({ apiKey });

    // Perform async execution without blocking start return
    this.performExecution(runId, openai, workPackage, runtimeContext).catch(
      () => {},
    );

    return { runId, status: 'RUNNING' };
  }

  private async performExecution(
    runId: string,
    openai: any,
    wp: WorkPackage,
    ctx: AgentRuntimeContext,
  ) {
    try {
      const response = await openai.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [{ role: 'system', content: wp.objective }],
        },
        {
          idempotencyKey: `${ctx.attemptId}-${runId}`,
        },
      );

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      this.updateState(runId, {
        status: 'COMPLETED',
        artifacts: [
          {
            artifactId: randomUUID(),
            type: 'PATCH',
            ref: content.substring(0, 50),
          },
        ],
        evidence: [
          {
            type: 'model',
            claimSupported: response.model,
            sourceRef: response.id,
          },
        ],
        usage: {
          inputUnits: response.usage?.prompt_tokens ?? 0,
          outputUnits: response.usage?.completion_tokens ?? 0,
          estimatedCost: 0,
          currency: 'USD',
        },
      });
    } catch (error: any) {
      const status = error.status;
      if (status === 429) {
        this.updateState(runId, { status: 'INTERRUPTED' });
      } else if (status === 401) {
        this.updateState(runId, { status: 'FAILED' }); // severity: CRITICAL handled upstream if needed
      } else {
        this.updateState(runId, { status: 'FAILED' }); // severity: HIGH handled upstream
      }
    }
  }

  async resume(resumeRequest: AgentResumeRequest): Promise<AgentRunHandle> {
    const run = this.runs.get(resumeRequest.runRef.runId);
    if (run) {
      run.status = 'COMPLETED';
    }
    return {
      runId: resumeRequest.runRef.runId,
      status: run?.status ?? 'UNKNOWN',
    };
  }

  async cancel(request: AgentCancelRequest): Promise<AgentCancelResult> {
    const run = this.runs.get(request.runRef.runId);
    if (run) run.status = 'CANCELLED';
    return { runRef: request.runRef, status: 'CANCELLED' };
  }

  async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> {
    return this.runs.get(runRef.runId)?.status ?? 'UNKNOWN';
  }

  async getArtifacts(runRef: AgentRunRef): Promise<ArtifactRef[]> {
    return this.runs.get(runRef.runId)?.artifacts ?? [];
  }

  async getEvidence(runRef: AgentRunRef): Promise<EvidenceRef[]> {
    return this.runs.get(runRef.runId)?.evidence ?? [];
  }

  async getUsage(runRef: AgentRunRef): Promise<AgentUsage> {
    return (
      this.runs.get(runRef.runId)?.usage ?? {
        inputUnits: 0,
        outputUnits: 0,
        estimatedCost: 0,
        currency: 'USD',
      }
    );
  }

  private updateState(runId: string, partial: Partial<CodexRunState>) {
    const current = this.runs.get(runId);
    if (current) {
      Object.assign(current, partial);
    }
  }
}
