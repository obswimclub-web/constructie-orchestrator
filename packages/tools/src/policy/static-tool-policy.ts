import type {
  ToolExecutionRequest,
  ToolPolicyEvaluation,
  ToolPolicyEvaluator,
} from '@co/contracts';

export interface StaticToolPolicyOptions {
  allowedOperations?: readonly string[];
  deniedOperations?: readonly string[];
}

export class StaticToolPolicy implements ToolPolicyEvaluator {
  private readonly allowed: Set<string>;
  private readonly denied: Set<string>;

  public constructor(options: StaticToolPolicyOptions = {}) {
    this.allowed = new Set(options.allowedOperations ?? []);
    this.denied = new Set(options.deniedOperations ?? []);
  }

  public async evaluate(request: ToolExecutionRequest): Promise<ToolPolicyEvaluation> {
    if (this.denied.has(request.operationId)) {
      return {
        requestId: request.requestId,
        decision: 'DENY',
        reasonCode: 'OPERATION_EXPLICITLY_DENIED',
        policyRefs: ['static-tool-policy'],
        authorityRefs: [request.authorityContextRef],
      };
    }

    if (!this.allowed.has(request.operationId)) {
      return {
        requestId: request.requestId,
        decision: 'DENY',
        reasonCode: 'OPERATION_NOT_ALLOWED',
        policyRefs: ['static-tool-policy'],
        authorityRefs: [request.authorityContextRef],
      };
    }

    return {
      requestId: request.requestId,
      decision: 'ALLOW',
      reasonCode: 'STATIC_POLICY_ALLOW',
      policyRefs: ['static-tool-policy'],
      authorityRefs: [request.authorityContextRef],
    };
  }
}
