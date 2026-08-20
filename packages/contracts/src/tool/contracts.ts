import { z } from 'zod';

export const TOOL_GATEWAY_CONTRACT_VERSION = '1.0.0' as const;
export const TOOL_EXECUTION_REQUEST_SCHEMA_VERSION = '1.0.0' as const;
export const TOOL_EXECUTION_RESULT_SCHEMA_VERSION = '1.0.0' as const;

export const ToolExecutionStatusSchema = z.enum([
  'SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN',
]);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;

export const ToolPolicyDecisionSchema = z.enum([
  'ALLOW', 'DENY', 'OWNER_DECISION_REQUIRED', 'EXTERNAL_ACTION_REQUIRED',
  'REQUIRE_ADDITIONAL_CONTROL', 'UNRESOLVED',
]);
export type ToolPolicyDecision = z.infer<typeof ToolPolicyDecisionSchema>;

export const ToolExecutionRequestSchema = z.object({
  schemaVersion: z.literal(TOOL_EXECUTION_REQUEST_SCHEMA_VERSION),
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  actorRef: z.string().min(1),
  workItemRef: z.string().min(1),
  workPackageRef: z.string().min(1),
  toolId: z.string().min(1),
  operationId: z.string().min(1),
  targetResource: z.string().min(1),
  environment: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).default({}),
  authorityContextRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().min(1),
}).strict();
export type ToolExecutionRequest = Readonly<z.infer<typeof ToolExecutionRequestSchema>>;

export const ToolPolicyEvaluationSchema = z.object({
  requestId: z.string().min(1),
  decision: ToolPolicyDecisionSchema,
  reasonCode: z.string().min(1),
  policyRefs: z.array(z.string()).default([]),
  authorityRefs: z.array(z.string()).default([]),
}).strict();
export type ToolPolicyEvaluation = z.infer<typeof ToolPolicyEvaluationSchema>;

export const AuthorizedToolRequestSchema = z.object({
  request: ToolExecutionRequestSchema,
  policy: ToolPolicyEvaluationSchema.extend({ decision: z.literal('ALLOW') }),
}).strict();
export type AuthorizedToolRequest = z.infer<typeof AuthorizedToolRequestSchema>;

export const ToolExecutionResultSchema = z.object({
  schemaVersion: z.literal(TOOL_EXECUTION_RESULT_SCHEMA_VERSION),
  executionId: z.string().min(1),
  requestId: z.string().min(1),
  toolId: z.string().min(1),
  operationId: z.string().min(1),
  status: ToolExecutionStatusSchema,
  summary: z.string(),
  observedEffect: z.string().optional(),
  artifacts: z.array(z.object({
    artifactId: z.string().min(1),
    type: z.string().min(1),
    ref: z.string().min(1),
  }).strict()).default([]),
  evidenceCandidates: z.array(z.object({
    type: z.string().min(1),
    claimSupported: z.string().min(1),
    sourceRef: z.string().min(1),
  }).strict()).default([]),
  sideEffects: z.array(z.string()).default([]),
  reconciliationRequired: z.boolean().default(false),
}).strict();
export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;

export interface ToolPolicyEvaluator {
  evaluate(request: ToolExecutionRequest): Promise<ToolPolicyEvaluation>;
}

export interface ToolGateway {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}

export interface ToolAdapter {
  readonly toolId: string;
  executeAuthorized(request: AuthorizedToolRequest): Promise<ToolExecutionResult>;
}
