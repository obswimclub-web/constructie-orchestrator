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

export class ToolNotRegisteredError extends Error {
  public readonly code = 'TOOL_NOT_REGISTERED';
}

export class GovernedToolGateway implements ToolGateway {
  private readonly adapters: Map<string, ToolAdapter>;

  public constructor(
    private readonly policy: ToolPolicyEvaluator,
    adapters: readonly ToolAdapter[],
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.toolId, adapter]));
  }

  public async execute(rawRequest: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const request = ToolExecutionRequestSchema.parse(rawRequest);
    const policy = await this.policy.evaluate(request);

    if (policy.decision !== 'ALLOW') {
      return ToolExecutionResultSchema.parse({
        schemaVersion: TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
        executionId: `denied:${request.requestId}`,
        requestId: request.requestId,
        toolId: request.toolId,
        operationId: request.operationId,
        status: 'DENIED',
        summary: `Tool execution denied: ${policy.reasonCode}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [],
        reconciliationRequired: false,
      });
    }

    const adapter = this.adapters.get(request.toolId);
    if (!adapter) throw new ToolNotRegisteredError(request.toolId);

    const authorized = AuthorizedToolRequestSchema.parse({ request, policy });
    const result = await adapter.executeAuthorized(authorized);
    return ToolExecutionResultSchema.parse(result);
  }
}
