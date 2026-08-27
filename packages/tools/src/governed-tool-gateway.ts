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
  OwnerGrantConsumer,
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
 *   - A new ActionPolicyEvaluator (full gate × class × authority enforcement)
 *
 * INVARIANT: When policy decision !== 'ALLOW', the ToolAdapter is NEVER invoked.
 * A denial is recorded in the audit ledger with executionResult = 'NOT_EXECUTED'.
 *
 * When an ActionPolicyEvaluator is used and the decision carries grantedByAuthority:
 *   1. Grant is RESERVED before adapter.executeAuthorized() is called.
 *   2. On SUCCEEDED → grant CONSUMED.
 *   3. On CANCELLED → grant released for retry (ACTIVE).
 *   4. On TIMED_OUT / FAILED / UNKNOWN → grant RECONCILIATION_REQUIRED.
 *
 * evaluatorKind discriminant ('ACTION_POLICY_EVALUATOR') is used to detect
 * which evaluator path to take — no Symbol brand required.
 *
 * Use createProductionGateway() to enforce ActionPolicyEvaluator in production.
 */
export class GovernedToolGateway implements ToolGateway {
  private readonly adapters: Map<string, ToolAdapter>;

  public constructor(
    private readonly policy: ToolPolicyEvaluator | ActionPolicyEvaluator,
    adapters: readonly ToolAdapter[],
    private readonly auditLedger?: ActionAuditLedger,
    private readonly grantConsumer?: OwnerGrantConsumer,
    private readonly redactor?: import('./security/output-redactor.js').OutputRedactor,
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.toolId, adapter]));
  }

  public async execute(rawRequest: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const request = ToolExecutionRequestSchema.parse(rawRequest);

    let decisionAllow: boolean;
    let reasonCode: string;
    let actionId: string | undefined;
    let grantedByAuthorityId: string | undefined;
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
      grantedByAuthorityId = actionDecision.grantedByAuthorityId;

      try {
        await this.auditLedger?.recordProposed({
          actionId: actionRequest.actionId,
          proposedAt: new Date(),
          request: actionRequest,
          classification: actionDecision.allClasses,
          decision: actionDecision,
        });
      } catch (err) {

        return ToolExecutionResultSchema.parse({
          schemaVersion: TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
          executionId: `audit-fail:${request.requestId}`,
          requestId: request.requestId,
          toolId: request.toolId,
          operationId: request.operationId,
          status: 'FAILED',
          summary: `Pre-execution audit failed: ${err instanceof Error ? err.message : String(err)}`,
          artifacts: [],
          evidenceCandidates: [],
          sideEffects: [],
          reconciliationRequired: false,
        });
      }

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

    // DENY: ToolAdapter is NEVER called
    if (!decisionAllow) {

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

    // Verify adapter exists before committing to execution
    const adapter = this.adapters.get(request.toolId);
    if (!adapter) throw new ToolNotRegisteredError(request.toolId);

    // ALLOW: reserve grant before adapter execution (if a token authorized the action)
    if (actionId && grantedByAuthorityId && this.grantConsumer) {
      this.grantConsumer.reserveGrant(grantedByAuthorityId, actionId);
    }

    // ALLOW: invoke ToolAdapter

    const authorized = AuthorizedToolRequestSchema.parse({ request, policy: policyForAuthorized });
    let result: ToolExecutionResult;
    try {
      result = await adapter.executeAuthorized(authorized);
    } catch (err) {
      // Execution threw — treat as TIMED_OUT / ambiguous failure
      if (actionId && grantedByAuthorityId && this.grantConsumer) {
        this.grantConsumer.requireReconciliation(grantedByAuthorityId, actionId);
      }
      throw err;
    }

    const parsed = ToolExecutionResultSchema.parse(result);

    // Post-execution grant lifecycle management
    if (actionId && grantedByAuthorityId && this.grantConsumer) {
      switch (parsed.status) {
        case 'SUCCEEDED':
          this.grantConsumer.consumeGrant(grantedByAuthorityId, actionId);
          break;
        case 'CANCELLED':
          // Proven not executed — release for retry
          this.grantConsumer.releaseGrantForRetry(grantedByAuthorityId, actionId);
          break;
        case 'TIMED_OUT':
        case 'FAILED':
        case 'UNKNOWN':
        default:
          // Ambiguous — require reconciliation before retry is authorized
          this.grantConsumer.requireReconciliation(grantedByAuthorityId, actionId);
          break;
      }
    }

    const sanitized = this.redactor ? { ...parsed, summary: this.redactor.redact(parsed.summary), observedEffect: this.redactor.redact(parsed.observedEffect || ''), evidenceCandidates: parsed.evidenceCandidates?.map(e => ({ ...e, claimSupported: this.redactor!.redact(e.claimSupported) })) } : parsed;
    if (actionId) {
      try {
        await this.auditLedger?.recordExecuted(
          actionId,
          sanitized,
        );
      } catch (err) {
        if (grantedByAuthorityId && this.grantConsumer) {
          this.grantConsumer.requireReconciliation(grantedByAuthorityId, actionId);
        }
        return ToolExecutionResultSchema.parse({
          ...sanitized,
          status: 'UNKNOWN',
          summary: sanitized.summary + `\n[AUDIT PERSISTENCE FAILED: ${err instanceof Error ? err.message : String(err)}]`,
          reconciliationRequired: true
        });
      }
    }

    return sanitized;
  }
}

/**
 * Production gateway factory — accepts ActionPolicyEvaluator only.
 * Use this in production composition roots to guarantee the canonical engine is wired.
 * Tests may use new GovernedToolGateway() directly with StaticToolPolicy.
 *
 * PRODUCTION_GATEWAY_REQUIRES_ACTION_POLICY=true
 */
export function createProductionGateway(
  policy: ActionPolicyEvaluator,
  adapters: readonly ToolAdapter[],
  auditLedger: ActionAuditLedger,
  grantConsumer?: OwnerGrantConsumer,
  redactor?: import('./security/output-redactor.js').OutputRedactor
): GovernedToolGateway {
  return new GovernedToolGateway(policy, adapters, auditLedger, grantConsumer, redactor);
}

// ─── Bridge: ToolExecutionRequest → ActionRequest ────────────────────────────

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

  const targetFilePaths: string[] = [];

  if (Array.isArray(params['filePaths'])) {
    targetFilePaths.push(...(params['filePaths'] as string[]));
  } else if (Array.isArray(params['requestedFilePaths'])) {
    targetFilePaths.push(...(params['requestedFilePaths'] as string[]));
  } else if (typeof params['path'] === 'string') {
    targetFilePaths.push(params['path']);
  } else if (typeof params['file'] === 'string') {
    targetFilePaths.push(params['file']);
  }

  if (request.targetResource && request.targetResource.startsWith('file://')) {
    const p = request.targetResource.replace('file://', '');
    if (!targetFilePaths.includes(p)) targetFilePaths.push(p);
  } else if (request.targetResource && request.targetResource.includes('/') && !request.targetResource.includes('://')) {
    if (!targetFilePaths.includes(request.targetResource)) targetFilePaths.push(request.targetResource);
  }

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
    targetFilePaths,
  };
  if (typeof params['command'] === 'string') Object.assign(base, { command: params['command'] });
  if (Array.isArray(params['args'])) Object.assign(base, { args: params['args'] as string[] });
  if (httpMethod !== undefined) Object.assign(base, { httpMethod });
  if (gitOp !== undefined) Object.assign(base, { gitOperation: gitOp });
  if (typeof params['generatedContent'] === 'string') {
    Object.assign(base, { generatedContent: params['generatedContent'] });
  }

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

// ─── Runtime evaluator identification ────────────────────────────────────────

/**
 * Identifies whether the evaluator is an ActionPolicyEvaluator using the
 * evaluatorKind discriminant.
 *
 * No Symbol brand needed — the discriminant literal is sufficient and
 * is always present on ActionClassifyingPolicyEngine instances.
 */
function isActionPolicyEvaluator(
  p: ToolPolicyEvaluator | ActionPolicyEvaluator,
): p is ActionPolicyEvaluator {
  return (p as ActionPolicyEvaluator).evaluatorKind === 'ACTION_POLICY_EVALUATOR';
}
