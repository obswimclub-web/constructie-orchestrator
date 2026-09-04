/* eslint-disable */
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
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
  AdapterHealth,
} from '@co/contracts';
import {
  TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
  ToolExecutionRequestSchema,
} from '@co/contracts';
import { parseProviderOutput } from '../codex/provider-output-parser.js';

type AnthropicRunState = {
  status: AgentRunStatus;
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];
  usage: AgentUsage;
  abortController?: AbortController;
};

/**
 * AnthropicAdapter
 *
 * Implements AgentAdapter for Anthropic-based code generation.
 */
export class AnthropicAdapter implements AgentAdapter {
  private readonly runs = new Map<string, AnthropicRunState>();

  constructor(
    private readonly gateway: ToolGateway,
    private readonly agentId: string = 'claude-adapter',
    private readonly anthropicClientFactory?: (apiKey: string) => any,
  ) {}

  async health(): Promise<AdapterHealth> {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return 'UNAVAILABLE';
      const client = this.anthropicClientFactory ? this.anthropicClientFactory(apiKey) : new Anthropic({ apiKey });
      await client.messages.create({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hello' }] }, { timeout: 2000 } as any);
      return 'AVAILABLE';
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) return 'UNAVAILABLE';
      if (e.status === 429 || e.status >= 500) return 'DEGRADED';
      return 'UNAVAILABLE';
    }
  }

  async capabilities(): Promise<CapabilityProfile> {
    return {
      capabilities: {
        code_generation: 'SUPPORTED',
        resumable_session: 'NOT_SUPPORTED',
      },
    };
  }

  async execute(
    workPackage: WorkPackage,
    runtimeContext: AgentRuntimeContext,
  ): Promise<AgentRunHandle> {
    const runId = randomUUID();
    const abortController = new AbortController();

    this.runs.set(runId, {
      status: 'RUNNING',
      artifacts: [],
      evidence: [],
      usage: {
        inputUnits: 0,
        outputUnits: 0,
        estimatedCost: 0,
        currency: 'USD',
        costStatus: 'UNKNOWN',
      },
      abortController,
    });

    const apiKey = runtimeContext.secretRefs.includes('OPENAI_API_KEY')
      ? process.env.ANTHROPIC_API_KEY
      : undefined;

    if (!apiKey) {
      this.updateState(runId, {
        status: 'FAILED',
        evidence: [
          {
            type: 'error',
            claimSupported: 'Missing API Key',
            sourceRef: 'AnthropicAdapter',
          },
        ],
      });
      return { runId, status: 'FAILED' };
    }

    const client = this.anthropicClientFactory
      ? this.anthropicClientFactory(apiKey)
      : new Anthropic({ apiKey });

    // Set up timeout if timeBudgetMs is specified
    if (runtimeContext.timeBudgetMs) {
      setTimeout(() => {
        abortController.abort();
        this.updateState(runId, {
          status: 'FAILED',
          evidence: [
            ...(this.runs.get(runId)?.evidence ?? []),
            { type: 'error', claimSupported: 'Timeout', sourceRef: 'AnthropicAdapter' },
          ],
        });
      }, runtimeContext.timeBudgetMs);
    }

    this.performExecution(runId, client, workPackage, runtimeContext, abortController.signal).catch(
      () => {},
    );

    return { runId, status: 'RUNNING' };
  }

  private async performExecution(
    runId: string,
    client: any,
    wp: WorkPackage,
    ctx: AgentRuntimeContext,
    signal: AbortSignal,
  ) {
    const MAX_RETRIES = 3;
    const retryEvidence: EvidenceRef[] = [];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal.aborted) return;
      try {
        // Anthropic uses messages.create API
        const response = await client.messages.create(
          {
            model: 'claude-3-5-sonnet-latest',
            max_tokens: 4096,
            messages: [{ role: 'user', content: wp.objective }],
          },
          { signal },
        );

        // Anthropic response structure: content[0].text, usage.input_tokens/output_tokens
        const content = response.content?.[0]?.text ?? response.choices?.[0]?.message?.content ?? '';

        // Malformed output detection
        let structured;
        try {
          structured = parseProviderOutput(content, {
            taskId: wp.workItemId,
            agentId: this.agentId,
            workPackageRef: wp.workPackageId,
            correlationId: ctx.correlationId,
          });
        } catch (parseErr: any) {
          this.updateState(runId, {
            status: 'FAILED',
            evidence: [
              { type: 'malformed_output', claimSupported: `Parse error: ${parseErr.message}`, sourceRef: 'AnthropicAdapter' },
            ],
          });
          return;
        }

        // Detect malformed output: if content looks like JSON but has no valid code block
        const trimmedContent = content.trim();
        if (trimmedContent && (trimmedContent.startsWith('{') || trimmedContent.startsWith('['))
            && !structured.toolProposals.length && !structured.artifacts.length
            && !content.includes('```')) {
          this.updateState(runId, {
            status: 'FAILED',
            evidence: [
              { type: 'malformed_output', claimSupported: 'Model returned malformed JSON without valid code block', sourceRef: 'AnthropicAdapter' },
            ],
          });
          return;
        }

        let runStatus: AgentRunStatus = 'COMPLETED';
        const denialEvidence: EvidenceRef[] = [];

        for (const proposal of structured.toolProposals) {
          const toolRequest = ToolExecutionRequestSchema.parse({
            schemaVersion: TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
            requestId: randomUUID(),
            projectId: wp.projectId,
            actorRef: this.agentId,
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

        // Anthropic: usage.input_tokens / usage.output_tokens
        // Also support OpenAI mock shape: usage.prompt_tokens / usage.completion_tokens
        const inputUnits = response.usage?.input_tokens ?? response.usage?.prompt_tokens ?? 0;
        const outputUnits = response.usage?.output_tokens ?? response.usage?.completion_tokens ?? 0;

        this.updateState(runId, {
          status: runStatus,
          artifacts: [
            ...structured.artifacts.map((a: any) => ({
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
            ...retryEvidence,
          ],
          usage: {
            inputUnits,
            outputUnits,
            estimatedCost: 0,
            currency: 'USD',
            costStatus: 'UNKNOWN',
          },
        });
        return; // success
      } catch (error: any) {
        const status = error.status;

        if (status === 429) {
          retryEvidence.push({
            type: 'retry',
            claimSupported: `Rate limited (429) on attempt ${attempt + 1}`,
            sourceRef: 'AnthropicAdapter',
          });
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          this.updateState(runId, {
            status: 'INTERRUPTED',
            evidence: retryEvidence,
          });
          return;
        } else if (status >= 500) {
          retryEvidence.push({
            type: 'retry',
            claimSupported: `Server error (${status}) on attempt ${attempt + 1}`,
            sourceRef: 'AnthropicAdapter',
          });
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          this.updateState(runId, {
            status: 'FAILED',
            evidence: retryEvidence,
          });
          return;
        } else if (error.name === 'AbortError' || signal.aborted) {
          return;
        } else {
          this.updateState(runId, { status: 'FAILED' });
          return;
        }
      }
    }
  }

  async resume(_resumeRequest: AgentResumeRequest): Promise<AgentRunHandle> {
    throw new Error('UNSUPPORTED: AnthropicAdapter does not support genuine session resumption.');
  }

  async cancel(request: AgentCancelRequest): Promise<AgentCancelResult> {
    const run = this.runs.get(request.runRef.runId);
    if (run) {
      run.abortController?.abort();
      run.status = 'CANCELLED';
    }
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
        costStatus: 'UNKNOWN',
      }
    );
  }

  private updateState(runId: string, partial: Partial<AnthropicRunState>) {
    const current = this.runs.get(runId);
    if (current) {
      Object.assign(current, partial);
    }
  }
}
