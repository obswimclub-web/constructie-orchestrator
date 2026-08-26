import { z } from 'zod';

export const AGENT_ADAPTER_CONTRACT_VERSION = '1.0.0' as const;
export const WORK_PACKAGE_SCHEMA_VERSION = '1.0.0' as const;
export const AGENT_RESULT_SCHEMA_VERSION = '1.0.0' as const;

export const AgentCapabilityStateSchema = z.enum([
  'SUPPORTED',
  'SUPPORTED_WITH_CONSTRAINTS',
  'NOT_SUPPORTED',
  'UNKNOWN',
]);
export type AgentCapabilityState = z.infer<typeof AgentCapabilityStateSchema>;

export const AgentRunStatusSchema = z.enum([
  'CREATED', 'QUEUED', 'STARTING', 'RUNNING', 'WAITING_FOR_TOOL', 'WAITING_FOR_INPUT',
  'COMPLETED', 'FAILED', 'CANCELLING', 'CANCELLED', 'INTERRUPTED', 'UNKNOWN',
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const WorkPackageSchema = z.object({
  schemaVersion: z.literal(WORK_PACKAGE_SCHEMA_VERSION),
  workPackageId: z.string().min(1),
  version: z.number().int().positive(),
  projectId: z.string().min(1),
  workItemId: z.string().min(1),
  completionObjectRef: z.string().min(1),
  objective: z.string().min(1),
  authoritativeInputs: z.array(z.object({
    ref: z.string().min(1),
    classification: z.enum(['AUTHORITATIVE', 'DERIVED', 'OBSERVED', 'PROPOSED']),
  })).default([]),
  scope: z.object({ refs: z.array(z.string()).default([]) }),
  constraints: z.array(z.string()).default([]),
  authorityContextRef: z.string().min(1),
  requiredCapabilities: z.array(z.string()).default([]),
  allowedActions: z.array(z.string()).default([]),
  forbiddenActions: z.array(z.string()).default([]),
  toolsAllowed: z.array(z.string()).default([]),
  expectedArtifactsOut: z.array(z.string()).default([]),
  verificationRequirements: z.array(z.string()).default([]),
  evidenceRequirements: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  stopConditions: z.array(z.string()).default([]),
}).strict();
export type WorkPackage = Readonly<z.infer<typeof WorkPackageSchema>>;

export const AgentRuntimeContextSchema = z.object({
  correlationId: z.string().min(1),
  workflowRunId: z.string().min(1),
  attemptId: z.string().min(1),
  sandboxRef: z.string().optional(),
  toolSessionRef: z.string().optional(),
  secretRefs: z.array(z.string()).default([]),
  timeBudgetMs: z.number().int().positive().optional(),
  costBudget: z.number().nonnegative().optional(),
}).strict();
export type AgentRuntimeContext = z.infer<typeof AgentRuntimeContextSchema>;

export const AgentRunRefSchema = z.object({ runId: z.string().min(1) }).strict();
export type AgentRunRef = z.infer<typeof AgentRunRefSchema>;
export type AgentRunHandle = AgentRunRef & { status: AgentRunStatus };

export const ArtifactRefSchema = z.object({
  artifactId: z.string().min(1),
  type: z.enum(['PATCH', 'FILE', 'COMMIT', 'BRANCH', 'PR', 'TEST_REPORT', 'BUILD', 'DEPLOYMENT', 'DOCUMENT', 'SCREENSHOT', 'LOG_BUNDLE']),
  ref: z.string().min(1),
}).strict();
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const EvidenceRefSchema = z.object({
  type: z.string(),
  claimSupported: z.string(),
  sourceRef: z.string(),
}).strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const AgentRunResultSchema = z.object({
  schemaVersion: z.literal(AGENT_RESULT_SCHEMA_VERSION),
  runRef: AgentRunRefSchema,
  status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
  summary: z.string(),
  actionsTaken: z.array(z.string()).default([]),
  artifacts: z.array(ArtifactRefSchema).default([]),
  findings: z.array(z.object({ claim: z.string(), severity: z.enum(['CRITICAL','HIGH','MEDIUM','LOW']), evidenceRefs: z.array(z.string()).default([]) })).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  unresolvedItems: z.array(z.string()).default([]),
  requestedInputs: z.array(z.string()).default([]),
  sideEffects: z.array(z.string()).default([]),
  usage: z.object({ inputUnits: z.number().nonnegative().default(0), outputUnits: z.number().nonnegative().default(0), estimatedCost: z.number().nonnegative().default(0), currency: z.string().default('USD') }),
}).strict();
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

export interface AgentAdapterIdentity {
  adapterId: string;
  provider: string;
  harness: string;
  adapterVersion: string;
  contractVersionSupported: string;
}
export interface CapabilityProfile { capabilities: Record<string, AgentCapabilityState>; }
export interface AgentUsage { inputUnits: number; outputUnits: number; estimatedCost: number; currency: string; }
export type AdapterHealth = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
export interface AgentResumeRequest { runRef: AgentRunRef; runtimeContext: AgentRuntimeContext; }
export interface AgentCancelRequest { runRef: AgentRunRef; reason: string; }
export interface AgentCancelResult { runRef: AgentRunRef; status: AgentRunStatus; }

export interface AgentAdapter {
  capabilities(): Promise<CapabilityProfile>;
  execute(workPackage: WorkPackage, runtimeContext: AgentRuntimeContext): Promise<AgentRunHandle>;
  resume(resumeRequest: AgentResumeRequest): Promise<AgentRunHandle>;
  cancel(request: AgentCancelRequest): Promise<AgentCancelResult>;
  getStatus(runRef: AgentRunRef): Promise<AgentRunStatus>;
  getArtifacts(runRef: AgentRunRef): Promise<ArtifactRef[]>;
  getEvidence(runRef: AgentRunRef): Promise<EvidenceRef[]>;
  getUsage(runRef: AgentRunRef): Promise<AgentUsage>;
}
