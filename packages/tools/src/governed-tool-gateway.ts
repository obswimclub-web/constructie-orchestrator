import { randomUUID } from 'node:crypto';
import {
  AuthorizedToolRequestSchema,
  TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
  ToolExecutionRequestSchema,
  ToolExecutionResultSchema,
  type ToolAdapter,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolGateway,
  type ToolPolicyEvaluator,
} from '@co/contracts';
import type {
  ActionAuditLedger,
  ActionPolicyEvaluator,
  ActionRequest,
} from '@co/policy';

export class ToolNotRegisteredError extends Error {
  public readonly code = 'TOOL_NOT_REGISTERED';
}

/**
 * GovernedToolGateway
 *
 * The mandatory enforcement choke-point between any action proposal and
 * the ToolAdapter execution layer.
 *
 * Accepts either:
 *   - A legacy ToolPolicyEvaluator (operationId set check — for tests / backward compat)
 *   - A new ActionPolicyEvaluator (full gate x class x authority enforcement)
 *
 * INVARIANT: When policy decision !== 'ALLOW', the ToolAdapter is NEVER invoked.
 * A denial is recorded in the audit ledger with executionResult = 'NOT_EXECUTED'.
 */
export class GovernedToolGateway implements ToolGateway {
  private readonly adapters: Map<string, ToolAdapter>;

  public constructor(
    private readonly policy: ToolPolicyEvaluator | ActionPolicyEvaluator,
    adapters: readonly ToolAdapter[],
    private readonly auditLedger?: ActionAuditLedger,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.toolId, adapter]));
  }

  public async execute(rawRequest: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const request = ToolExecutionRequestSchema.parse(rawRequest);

    let decisionAllow: boolean;
    let reasonCode: string;
    let actionId: string | undefined;
    let policyForAuthorized: {
      requestId: string;
      decision: 'ALLOW';
      reasonCode: string;
      policyRefs: string[];
      authorityRefs: string[];
    } | undefined;

    if (isActionPolicyEvaluator(this.policy)) {
      const actionRequest = bridgeToActionRequest(request);
      actionId = actionRequest.actionId;
      const actionDecision = await this.policy.evaluate(actionRequest);

      decisionAllow = actionDecision.decision === 'ALLOW';
      reasonCode = actionDecision.policyRule;

      this.auditLedger?.recordProposed({
        actionId: actionRequest.actionId,
        proposedAt: new Date(),
        request: actionRequest,
        classification: actionDecision.allClasses,
        decision: actionDecision,
      });

      if (decisionAllow) {
        policyForAuthorized = {
          requestId: request.requestId,
          decision: 'ALLOW' as const,
          reasonCode,
          policyRefs: ['action-classifying-policy-engine'],
          authorityRefs: [request.authorityContextRef],
        };
      }
    } else {
      const legacyDecision = await (this.policy as ToolPolicyEvaluator).evaluate(request);
      decisionAllow = legacyDecision.decision === 'ALLOW';
      reasonCode = legacyDecision.reasonCode;
      if (decisionAllow) {
        policyForAuthorized = {
          requestId: request.requestId,
          decision: 'ALLOW' as const,
          reasonCode,
          policyRefs: legacyDecision.policyRefs,
          authorityRefs: legacyDecision.authorityRefs,
        };
      }
    }

    // DENY: tool adapter is NEVER called
    if (!decisionAllow) {
      if (actionId) this.auditLedger?.recordExecuted(actionId, 'NOT_EXECUTED');

      return ToolExecutionResultSchema.parse({
        schemaVersion: TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
        executionId: `denied:${request.requestId}`,
        requestId: request.requestId,
        toolId: request.toolId,
        operationId: request.operationId,
        status: 'DENIED',
        summary: `Tool execution denied: ${reasonCode}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [],
        reconciliationRequired: false,
      });
    }

    // ALLOW: tool adapter is called
    const adapter = this.adapters.get(request.toolId);
    if (!adapter) throw new ToolNotRegisteredError(request.toolId);

    const authorized = AuthorizedToolRequestSchema.parse({ request, policy: policyForAuthorized });
    const result = await adapter.executeAuthorized(authorized);
    const parsed = ToolExecutionResultSchema.parse(result);

    if (actionId) {
      this.auditLedger?.recordExecuted(
        actionId,
        parsed.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      );
    }

    return parsed;
  }
}

function bridgeToActionRequest(request: ToolExecutionRequest): ActionRequest {
  const params = request.parameters as Record<string, unknown>;

  const gitOp =
    request.toolId === 'git'
      ? String(params['subcommand'] ?? request.operationId.replace('git.', ''))
      : undefined;

  const httpMethod =
    typeof params['method'] === 'string'
      ? (params['method'].toUpperCase() as ActionRequest['httpMethod'])
      : request.toolId === 'http' || request.toolId === 'fetch'
        ? extractHttpMethodFromOperation(request.operationId)
        : undefined;

  const base: ActionRequest = {
    actionId: randomUUID(),
    taskId: request.workItemRef,
    agentId: request.actorRef,
    provider: String(params['provider'] ?? 'unknown'),
    tool: request.toolId,
    operation: request.operationId,
    resource: request.targetResource,
    environment: mapEnvironment(request.environment),
    parameters: request.parameters,
    authorityContextRef: request.authorityContextRef,
    correlationId: request.correlationId,
  };
  if (typeof params['command'] === 'string') Object.assign(base, { command: params['command'] });
  if (Array.isArray(params['args'])) Object.assign(base, { args: params['args'] as string[] });
  if (httpMethod !== undefined) Object.assign(base, { httpMethod });
  if (gitOp !== undefined) Object.assign(base, { gitOperation: gitOp });
  if (Array.isArray(params['filePaths'])) {
    Object.assign(base, { requestedFilePaths: params['filePaths'] as string[] });
  } else if (typeof params['path'] === 'string') {
    Object.assign(base, { requestedFilePaths: [params['path']] });
  }
  if (typeof params['content'] === 'string') Object.assign(base, { generatedContent: params['content'] });
  return base;
}

function extractHttpMethodFromOperation(
  operationId: string,
): ActionRequest['httpMethod'] | undefined {
  const lower = operationId.toLowerCase();
  if (lower.includes('get')) return 'GET';
  if (lower.includes('post')) return 'POST';
  if (lower.includes('put')) return 'PUT';
  if (lower.includes('patch')) return 'PATCH';
  if (lower.includes('delete')) return 'DELETE';
  return undefined;
}

function mapEnvironment(env: string): ActionRequest['environment'] {
  switch (env.toLowerCase()) {
    case 'production':
    case 'prod':
      return 'PRODUCTION';
    case 'staging':
    case 'stage':
      return 'STAGING';
    case 'test':
      return 'TEST';
    default:
      return 'LOCAL';
  }
}

export const ACTION_POLICY_BRAND: unique symbol = Symbol('ActionPolicyEvaluator');

function isActionPolicyEvaluator(
  p: ToolPolicyEvaluator | ActionPolicyEvaluator,
): p is ActionPolicyEvaluator {
  return ACTION_POLICY_BRAND in p;
}
