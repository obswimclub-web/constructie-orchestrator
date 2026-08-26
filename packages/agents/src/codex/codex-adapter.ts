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
  ToolGateway,
  WorkPackage,
} from '@co/contracts';
import {
  TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
  ToolExecutionRequestSchema,
} from '@co/contracts';
import { parseProviderOutput } from './provider-output-parser.js';

type CodexRunState = {
  status: AgentRunStatus;
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];
  usage: AgentUsage;
};

/**
 * CodexAdapter
 *
 * Implements AgentAdapter for OpenAI-based code generation.
 *
 * Policy boundary:
 *
 *   MODEL_INFERENCE:
 *     openai.chat.completions.create() is a direct, unrestricted call.
 *     It is reasoning/inference — not a mutating tool action.
 *     MODEL_INFERENCE_REQUIRES_POLICY=false
 *
 *   TOOL_EXECUTION:
 *     Any ToolProposal extracted from the model response by parseProviderOutput()
 *     is submitted through the injected ToolGateway before execution.
 *     The gateway applies ActionClassifyingPolicyEngine and returns ALLOW or DENIED.
 *     TOOL_EXECUTION_REQUIRES_POLICY=true
 *
 * The ToolGateway is injected at construction — CodexAdapter never holds raw
 * ToolAdapter references or OwnerEventProcessor references.
 */
export class CodexAdapter implements AgentAdapter {
  private readonly runs = new Map<string, CodexRunState>();

  constructor(
    private readonly gateway: ToolGateway,
    private readonly openaiClientFactory?: (apiKey: string) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ) {}

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

    // MODEL_INFERENCE: direct call — not a mutating tool action.
    // Policy applies to ToolProposals extracted from the response, not to this call.
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
    openai: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    wp: WorkPackage,
    ctx: AgentRuntimeContext,
  ) {
    try {
      // MODEL_INFERENCE: direct call — not a mutating tool action.
      // Policy applies to ToolProposals extracted from the response, not to this call.
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

      // TOOL_EXECUTION: parse structured output, submit proposals through gateway.
      // MODEL_TEXT_IS_NOT_EXECUTABLE=true — only schema-valid proposals are executable.
      const structured = parseProviderOutput(content, {
        taskId: wp.workItemId,
        agentId: 'codex-adapter',
        workPackageRef: wp.workPackageId,
        correlationId: ctx.correlationId,
      });

      // Submit each tool proposal through the gateway (policy enforcement point)
      let runStatus: AgentRunStatus = 'COMPLETED';
      const denialEvidence: EvidenceRef[] = [];

      for (const proposal of structured.toolProposals) {
        const toolRequest = ToolExecutionRequestSchema.parse({
          schemaVersion: TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
          requestId: randomUUID(),
          projectId: wp.projectId,
          actorRef: 'codex-adapter',
          workItemRef: wp.workItemId,
          workPackageRef: wp.workPackageId,
          toolId: proposal.toolId,
          operationId: proposal.operationId,
          targetResource: proposal.targetResource,
          environment: proposal.environment,
          parameters: proposal.parameters,
          authorityContextRef: wp.authorityContextRef,
          idempotencyKey: randomUUID(),
          correlationId: ctx.correlationId,
        });

        const result = await this.gateway.execute(toolRequest);
        if (result.status === 'DENIED') {
          runStatus = 'FAILED';
          denialEvidence.push({
            type: 'tool_denial',
            claimSupported: result.summary,
            sourceRef: toolRequest.requestId,
          });
        } else if (result.status === 'FAILED' || result.status === 'TIMED_OUT' || result.status === 'UNKNOWN') {
          runStatus = 'FAILED';
        } else if (result.status === 'CANCELLED' && runStatus === 'COMPLETED') {
          runStatus = 'CANCELLED';
        }
      }

      this.updateState(runId, {
        status: runStatus,
        artifacts: [
          ...structured.artifacts.map(a => ({
            artifactId: randomUUID(),
            type: (a.type as ArtifactRef['type']) || 'PATCH' as const,
            ref: a.ref,
          })),
          {
            artifactId: randomUUID(),
            type: 'PATCH' as const,
            ref: content.substring(0, 50),
          },
        ],
        evidence: [
          {
            type: 'model',
            claimSupported: response.model,
            sourceRef: response.id,
          },
          ...denialEvidence,
        ],
        usage: {
          inputUnits: response.usage?.prompt_tokens ?? 0,
          outputUnits: response.usage?.completion_tokens ?? 0,
          estimatedCost: 0,
          currency: 'USD',
        },
      });
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const status = error.status;
      if (status === 429) {
        this.updateState(runId, { status: 'INTERRUPTED' });
      } else if (status === 401) {
        this.updateState(runId, { status: 'FAILED' });
      } else {
        this.updateState(runId, { status: 'FAILED' });
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
