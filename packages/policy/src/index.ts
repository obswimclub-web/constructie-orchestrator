/**
 * @package @co/policy
 *
 * Pre-Execution Policy Enforcement Layer — public API.
 *
 * Agents and providers may import ReadOnlyExecutionContext and the type contracts.
 * They must NOT receive TrustedOwnerAuthorityIssuer, OwnerEventProcessor,
 * or OwnerGrantConsumer references.
 */

// ─── Canonical types ──────────────────────────────────────────────────────────
export type {
  ActionAuditLedger,
  ActionDeniedResult,
  ActionPolicyDecision,
  ActionPolicyEvaluator,
  ActionRequest,
  AuditEntry,
  AuditEntryProposed,
  AuthorityGrantStatus,
  AuthorityGrantView,
  Environment,
  ExecutionGate,
  GateRule,
  GuardViolation,
  MutationClass,
  OwnerAuthorityToken,
  OwnerGrantConsumer,
  PolicyDecision,
} from './types.js';

export {
  AUTHORITY_GRANT_STATUSES,
  ENVIRONMENTS,
  EXECUTION_GATES,
  MUTATION_CLASSES,
  OWNER_AUTHORITY_TOKENS,
} from './types.js';

// ─── ReadOnlyExecutionContext (agent/policy surface) ─────────────────────────
export type { ReadOnlyExecutionContext } from './context/read-only-execution-context.js';

// ─── Owner authority event types (data shapes only) ──────────────────────────
export type {
  ApprovedScopeEventFields,
  GateTransitionEventFields,
  GateTransitionRule,
  OwnerAuthorityEventFields,
  OwnerEventProcessorOptions,
} from './context/owner-authority-event.js';

export { GATE_TRANSITION_POLICY } from './context/owner-authority-event.js';

// ─── TrustedOwnerAuthorityIssuer + sealed event classes ──────────────────────
// Composition root imports these to create and apply events.
// NOTE: The OWNER_EVENT_BRAND / GATE_EVENT_BRAND / SCOPE_EVENT_BRAND symbols
//       are NOT exported — they remain module-private in trusted-owner-authority-issuer.ts.
//       isOwnerAuthorityEvent / isGateTransitionEvent / isApprovedScopeEvent are
//       exported for use by OwnerEventProcessor only; they cannot forge events.
export {
  TrustedOwnerAuthorityIssuer,
  SealedOwnerAuthorityEvent,
  SealedGateTransitionEvent,
  SealedApprovedScopeEvent,
  isOwnerAuthorityEvent,
  isGateTransitionEvent,
  isApprovedScopeEvent,
} from './context/trusted-owner-authority-issuer.js';

// ─── OwnerEventProcessor + errors ────────────────────────────────────────────
export {
  OwnerEventProcessor,
  GateTransitionNotPermittedError,
  GrantNotFoundError,
  TaskMismatchError,
  UntrustedOwnerEventError,
} from './context/owner-event-processor.js';

// ─── Policy engine ────────────────────────────────────────────────────────────
export { ActionClassifyingPolicyEngine } from './engine/action-classifying-policy-engine.js';

// ─── Classification + guards ──────────────────────────────────────────────────
export {
  ActionClassifier,
  AuthCredentialScriptGuard,
  SecretFileGuard,
  SecretLiteralGuard,
  SecretOutputGuard,
} from './classification/action-classifier.js';

// ─── Audit ledger ─────────────────────────────────────────────────────────────
export { InMemoryExecutionAuditLedger } from './ledger/execution-audit-ledger.js';
