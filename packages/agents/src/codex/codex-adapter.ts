import crypto from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function __evId(base: string, claim: any): string {
  const hash = crypto.createHash('sha256').update(base + ':' + String(claim)).digest('hex').slice(0, 32);
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-4' + hash.slice(13, 16) + '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
}
/* eslint-disable */
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
  AdapterHealth,
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
  abortController?: AbortController;
};

/**
 * CodexAdapter
 *
 * Implements AgentAdapter for OpenAI-based code generation.
 */
export class CodexAdapter implements AgentAdapter {
  private readonly runs = new Map<string, CodexRunState>();

  constructor(
    private readonly gateway: ToolGateway,
    private readonly agentId: string = 'codex-adapter',
    private readonly openaiClientFactory?: (apiKey: string) => any,
  ) {}

  async health(): Promise<AdapterHealth> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return 'UNAVAILABLE';
      const client = this.openaiClientFactory ? this.openaiClientFactory(apiKey) : new OpenAI({ apiKey });
      await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, { timeout: 2000 });
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
      ? process.env.OPENAI_API_KEY
      : undefined;

    if (!apiKey) {
      this.updateState(runId, {
        status: 'FAILED',
        evidence: [
          {
            type: 'error',
            evidenceId: __evId(runId, 'Missing API Key'), claimSupported: 'Missing API Key',
            sourceRef: 'CodexAdapter',
          },
        ],
      });
      return { runId, status: 'FAILED' };
    }

    const openai = this.openaiClientFactory
      ? this.openaiClientFactory(apiKey)
      : new OpenAI({ apiKey });

    // Set up timeout if timeBudgetMs is specified
    if (runtimeContext.timeBudgetMs) {
      setTimeout(() => {
        abortController.abort();
        this.updateState(runId, {
          status: 'FAILED',
          evidence: [
            ...(this.runs.get(runId)?.evidence ?? []),
            { type: 'error', evidenceId: __evId(runId, 'Timeout'), claimSupported: 'Timeout', sourceRef: 'CodexAdapter' },
          ],
        });
      }, runtimeContext.timeBudgetMs);
    }

    // Perform async execution without blocking start return
    this.performExecution(runId, openai, workPackage, runtimeContext, abortController.signal).catch(
      () => {},
    );

    return { runId, status: 'RUNNING' };
  }

  private async performExecution(
    runId: string,
    openai: any,
    wp: WorkPackage,
    ctx: AgentRuntimeContext,
    signal: AbortSignal,
  ) {
    const MAX_RETRIES = 3;
    let lastError: any = null;
    const retryEvidence: EvidenceRef[] = [];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal.aborted) return;
      try {
        const response = await openai.chat.completions.create(
          {
            model: 'gpt-4o',
            messages: [{ role: 'system', content: wp.objective }],
          },
          {
            idempotencyKey: `${ctx.attemptId}-${runId}`,
            signal,
          },
        );

        const choice = response.choices[0];
        const content = choice?.message?.content ?? '';

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
              { type: 'malformed_output', evidenceId: __evId(runId, `Parse error: ${parseErr.message}`), claimSupported: `Parse error: ${parseErr.message}`, sourceRef: 'CodexAdapter' },
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
              { type: 'malformed_output', evidenceId: __evId(runId, 'Model returned malformed JSON without valid code block'), claimSupported: 'Model returned malformed JSON without valid code block', sourceRef: 'CodexAdapter' },
            ],
          });
          return;
        }

        // Submit each tool proposal through the gateway (policy enforcement point)
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
              evidenceId: __evId(runId, result.summary), claimSupported: result.summary,
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
              evidenceId: __evId(runId, response.model), claimSupported: response.model,
              sourceRef: response.id,
            },
            ...denialEvidence,
            ...retryEvidence,
          ],
          usage: {
            inputUnits: response.usage?.prompt_tokens ?? 0,
            outputUnits: response.usage?.completion_tokens ?? 0,
            estimatedCost: 0,
            currency: 'USD',
            costStatus: 'UNKNOWN',
          },
        });
        return; // success
      } catch (error: any) {
        lastError = error;
        const status = error.status;

        if (status === 429) {
          retryEvidence.push({
            type: 'retry',
            evidenceId: __evId(runId, `Rate limited (429) on attempt ${attempt + 1}`), claimSupported: `Rate limited (429) on attempt ${attempt + 1}`,
            sourceRef: 'CodexAdapter',
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
            evidenceId: __evId(runId, `Server error (${status}) on attempt ${attempt + 1}`), claimSupported: `Server error (${status}) on attempt ${attempt + 1}`,
            sourceRef: 'CodexAdapter',
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
          // Timeout or cancellation - state already set by abort handler
          return;
        } else {
          this.updateState(runId, { status: 'FAILED' });
          return;
        }
      }
    }
  }

  async resume(_resumeRequest: AgentResumeRequest): Promise<AgentRunHandle> {
    throw new Error('UNSUPPORTED: CodexAdapter does not support genuine session resumption.');
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

  private updateState(runId: string, partial: Partial<CodexRunState>) {
    const current = this.runs.get(runId);
    if (current) {
      Object.assign(current, partial);
    }
  }
}
