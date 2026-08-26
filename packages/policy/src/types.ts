/**
 * @package @co/policy
 *
 * Canonical types for the Pre-Execution Policy Enforcement Layer.
 * Every proposed tool action must be classified and authorized here
 * BEFORE reaching any ToolAdapter or external runtime.
 */

// ─── Mutation Classes ────────────────────────────────────────────────────────

/**
 * Every action is classified into one or more MutationClasses before execution.
 * Classification drives gate-level allow/deny decisions.
 * One action may carry multiple classes (e.g. `prisma db pull` = DATABASE_READ + SCHEMA_SOURCE_MUTATION).
 */
export const MUTATION_CLASSES = [
  'READ_ONLY',
  'LOCAL_MUTATION',
  'SOURCE_MUTATION',
  'GIT_STAGE',
  'GIT_COMMIT',
  'GIT_PUSH',
  'GIT_DESTRUCTIVE',
  'DEPLOYMENT',
  'PRODUCTION_READ',
  'PRODUCTION_MUTATION',
  'DATABASE_READ',
  'DATABASE_MUTATION',
  'SCHEMA_MUTATION',
  'SCHEMA_SOURCE_MUTATION', // e.g. prisma db pull — reads DB, mutates source files
  'SECRET_READ',
  'SECRET_OUTPUT',
  'CREDENTIAL_USE',
  'AUTH_SESSION_CREATION',
  'DESTRUCTIVE',
  'UNKNOWN', // fail-closed trigger
] as const;

export type MutationClass = (typeof MUTATION_CLASSES)[number];

// ─── Execution Gates ──────────────────────────────────────────────────────────

/**
 * A project execution passes through ordered gates.
 * The Policy Engine resolves the current gate from ReadOnlyExecutionContext
 * and applies the corresponding allow/deny rule matrix.
 */
export const EXECUTION_GATES = [
  'AUDIT',
  'PLAN',
  'OWNER_PLAN_REVIEW',
  'IMPLEMENTATION',
  'TEST',
  'OWNER_PRECOMMIT',
  'COMMIT',
  'PUSH',
  'DEPLOY',
  'PRODUCTION_VALIDATION',
  'PRODUCTION_VALIDATION_READ_ONLY',
  'OWNER_FINAL_CLOSURE',
] as const;

export type ExecutionGate = (typeof EXECUTION_GATES)[number];

// ─── Owner Authority Tokens ───────────────────────────────────────────────────

/**
 * Machine-enforceable owner authority grants.
 * An action requiring a grant FAILS before execution when that grant is absent.
 * Tokens are NEVER inferred from prose; they must be issued by TrustedOwnerAuthorityIssuer
 * and applied through OwnerEventProcessor.
 */
export const OWNER_AUTHORITY_TOKENS = [
  'OWNER_PLAN_APPROVED',
  'OWNER_IMPLEMENTATION_APPROVED',
  'OWNER_COMMIT_APPROVED',
  'OWNER_PUSH_APPROVED',
  'OWNER_DEPLOY_APPROVED',
  'OWNER_PRODUCTION_MUTATION_APPROVED',
  'OWNER_SCHEMA_CHANGE_APPROVED',
] as const;

export type OwnerAuthorityToken = (typeof OWNER_AUTHORITY_TOKENS)[number];

// ─── Authority Grant Lifecycle ────────────────────────────────────────────────

/**
 * Grant state machine:
 *
 *   ISSUED → ACTIVE → RESERVED(actionId) → CONSUMED          (on SUCCEEDED)
 *                                         → ACTIVE            (on PROVEN_NOT_EXECUTED
 *                                                               or FAILED_WITH_CONFIRMED_NO_SIDE_EFFECT)
 *                                         → RECONCILIATION_REQUIRED (on TIMED_OUT / FAILED /
 *                                                                     CONNECTION_LOST / UNKNOWN_RESULT)
 *
 * A grant in RECONCILIATION_REQUIRED may NOT automatically authorize a retry.
 * The Orchestrator must reconcile before the same token can be used again.
 *
 * INVARIANT: NO_SENSITIVE_ACTION_CAN_BE_DUPLICATED_DUE_TO_AMBIGUOUS_FAILURE=true
 */
export const AUTHORITY_GRANT_STATUSES = [
  'ISSUED',
  'ACTIVE',
  'RESERVED',
  'CONSUMED',
  'RECONCILIATION_REQUIRED',
] as const;

export type AuthorityGrantStatus = (typeof AUTHORITY_GRANT_STATUSES)[number];

export interface AuthorityGrantView {
  readonly token: OwnerAuthorityToken;
  readonly taskId: string;
  readonly status: AuthorityGrantStatus;
  /** Set when status = RESERVED; the actionId this grant is reserved for. */
  readonly reservedForActionId?: string | undefined;
  /** Gate the grant is bound to; undefined = any gate (rare). */
  readonly boundToGate?: ExecutionGate | undefined;
  /**
   * MutationClass action bound (e.g. 'GIT_COMMIT').
   * Grant verification checks this matches the proposed action's primary class.
   */
  readonly boundToAction?: string | undefined;
  readonly issuedAt: Date;
}

// ─── Owner Grant Consumer (gateway-only capability) ───────────────────────────

/**
 * Capability exposed to GovernedToolGateway ONLY for post-execution grant lifecycle management.
 * Agent/provider code must never receive this interface.
 */
export interface OwnerGrantConsumer {
  /**
   * Reserve the grant for a specific actionId before executing.
   * Transitions ACTIVE → RESERVED(actionId).
   */
  reserveGrant(token: OwnerAuthorityToken, actionId: string): void;

  /**
   * Consume the grant after confirmed successful execution.
   * Transitions RESERVED → CONSUMED.
   */
  consumeGrant(token: OwnerAuthorityToken, actionId: string): void;

  /**
   * Release the grant back to ACTIVE for retry after proven-not-executed failure.
   * Transitions RESERVED → ACTIVE.
   * Only valid for: PROVEN_NOT_EXECUTED, FAILED_WITH_CONFIRMED_NO_SIDE_EFFECT, CANCELLED.
   */
  releaseGrantForRetry(token: OwnerAuthorityToken, actionId: string): void;

  /**
   * Mark the grant as requiring reconciliation after ambiguous execution result.
   * Transitions RESERVED → RECONCILIATION_REQUIRED.
   * Applies to: TIMED_OUT, FAILED (ambiguous), CONNECTION_LOST, UNKNOWN_RESULT.
   */
  requireReconciliation(token: OwnerAuthorityToken, actionId: string): void;
}

// ─── Environment ─────────────────────────────────────────────────────────────

export const ENVIRONMENTS = ['LOCAL', 'TEST', 'STAGING', 'PRODUCTION'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

// ─── Action Request (Canonical Envelope) ─────────────────────────────────────

/**
 * Every proposed tool action MUST be normalized into an ActionRequest
 * before the policy engine can evaluate it.
 * This is a superset of ToolExecutionRequest with structured intent fields.
 */
export interface ActionRequest {
  /** Unique ID for this action proposal */
  readonly actionId: string;
  /** Owning task/work-item */
  readonly taskId: string;
  /** Agent/provider making the request */
  readonly agentId: string;
  /** Provider name (e.g. 'codex', 'claude', 'antigravity') */
  readonly provider: string;
  /** Logical tool (e.g. 'shell', 'git', 'http', 'filesystem', 'database') */
  readonly tool: string;
  /** Specific operation within the tool (e.g. 'shell.exec', 'git.push', 'http.post') */
  readonly operation: string;
  /** Raw command string if shell-based (used for pattern matching) */
  readonly command?: string;
  /** Parsed command arguments */
  readonly args?: readonly string[];
  /** Target resource (file path, URL, table name, etc.) */
  readonly resource: string;
  /** HTTP method if this is an HTTP action */
  readonly httpMethod?: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Git sub-command if this is a git action */
  readonly gitOperation?: string;
  /** Environment this action targets */
  readonly environment: Environment;
  /** Free-form parameters passed to the tool */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Authority context reference (matches WorkPackage.authorityContextRef) */
  readonly authorityContextRef: string;
  /** Correlation for tracing */
  readonly correlationId: string;
  /**
   * For SOURCE_MUTATION / GIT_STAGE / GIT_COMMIT actions:
   * the set of file paths the provider intends to modify/stage/commit.
   * Validated against ReadOnlyExecutionContext.approvedFiles.
   */
  readonly requestedFilePaths?: readonly string[];
  /**
   * Content of generated scripts/files (before write).
   * Required for SecretLiteralGuard and AuthCredentialScriptGuard.
   */
  readonly generatedContent?: string;
}

// ─── Policy Decision ──────────────────────────────────────────────────────────

export const POLICY_DECISIONS = [
  'ALLOW',
  'DENY',
  'REQUIRE_APPROVAL', // ambiguous classification — fail-closed
  'OWNER_DECISION_REQUIRED',
] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/**
 * Structured decision returned for every evaluated action.
 * When decision = DENY, the LLM may reason about the denial but CANNOT execute around it.
 */
export interface ActionPolicyDecision {
  readonly actionId: string;
  readonly decision: PolicyDecision;
  /** Human-readable rule code for the denial reason */
  readonly policyRule: string;
  /** The gate that was active during evaluation */
  readonly currentGate: ExecutionGate;
  /** Authority token required to unlock this action (when DENY due to missing token) */
  readonly requiredAuthority?: OwnerAuthorityToken | undefined;
  /**
   * When decision = ALLOW and the ALLOW was granted by a specific authority token,
   * this field identifies that token. The gateway uses this to manage grant lifecycle
   * (RESERVE before execution, CONSUME after success, REQUIRE_RECONCILIATION on ambiguity).
   */
  readonly grantedByAuthority?: OwnerAuthorityToken | undefined;
  /** The mutation classes that triggered the denial */
  readonly triggeringClasses: readonly MutationClass[];
  /** Full set of classes the action was classified into */
  readonly allClasses: readonly MutationClass[];
  readonly reason: string;
}

/**
 * Result returned when an action is DENIED. The ToolAdapter is NEVER called.
 */
export interface ActionDeniedResult {
  readonly kind: 'ACTION_DENIED';
  readonly actionId: string;
  readonly policyDecision: ActionPolicyDecision;
  readonly executionResult: 'NOT_EXECUTED';
}

// ─── Guard Result ─────────────────────────────────────────────────────────────

/**
 * Returned by individual guards when they detect a violation.
 * null = no violation detected by this guard.
 */
export interface GuardViolation {
  readonly guardName: string;
  readonly ruleCode: string;
  readonly detail: string;
}

// ─── Gate Policy Rule ─────────────────────────────────────────────────────────

/**
 * Policy matrix entry for a single gate.
 * Classes in allowedClasses are allowed by default.
 * Classes in deniedClasses are hard-denied regardless of tokens.
 * requiredTokens maps MutationClass → required OwnerAuthorityToken.
 */
export interface GateRule {
  readonly allowedClasses: readonly MutationClass[];
  readonly deniedClasses: readonly MutationClass[];
  /** For each MutationClass that IS allowed, what token is additionally required? */
  readonly requiredTokens: Partial<Record<MutationClass, OwnerAuthorityToken>>;
  /** Whether to enforce approved file scope for SOURCE_MUTATION / GIT_STAGE / GIT_COMMIT */
  readonly enforceFileScope: boolean;
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

/**
 * The canonical pre-execution policy evaluator interface.
 *
 * evaluatorKind discriminant allows GovernedToolGateway to distinguish
 * ActionPolicyEvaluator from legacy ToolPolicyEvaluator at runtime
 * without relying on Symbol brand injection.
 */
export interface ActionPolicyEvaluator {
  readonly evaluatorKind: 'ACTION_POLICY_EVALUATOR';
  evaluate(request: ActionRequest): Promise<ActionPolicyDecision>;
}

export interface ActionAuditLedger {
  recordProposed(entry: AuditEntryProposed): void;
  recordExecuted(actionId: string, result: 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'NOT_EXECUTED'): void;
  entries(): readonly AuditEntry[];
}

export interface AuditEntryProposed {
  readonly actionId: string;
  readonly proposedAt: Date;
  readonly request: ActionRequest;
  readonly classification: readonly MutationClass[];
  readonly decision: ActionPolicyDecision;
}

export interface AuditEntry extends AuditEntryProposed {
  readonly executedAt?: Date | undefined;
  readonly executionResult?: 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'NOT_EXECUTED' | undefined;
}
