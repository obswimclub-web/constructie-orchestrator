import type { Environment, ExecutionGate, OwnerAuthorityToken } from '../types.js';

/**
 * Canonical gate transition policy.
 *
 * Defines which gates can transition to which, and what authority token
 * (if any) must be ACTIVE before the transition is permitted.
 *
 * Gate transition verifies the token EXISTS but does NOT consume it.
 * The grant is consumed by the subsequent authorized action (via OwnerGrantConsumer).
 *
 * Transitions not in this table are PROHIBITED — OwnerEventProcessor throws
 * GateTransitionNotPermittedError for any unlisted transition.
 */
export interface GateTransitionRule {
  readonly from: ExecutionGate;
  readonly to: ExecutionGate;
  /** If set, this token must be ACTIVE before the transition is permitted. */
  readonly requiredToken?: OwnerAuthorityToken;
}

export const GATE_TRANSITION_POLICY: readonly GateTransitionRule[] = [
  { from: 'AUDIT',              to: 'PLAN' },
  { from: 'PLAN',               to: 'OWNER_PLAN_REVIEW' },
  { from: 'OWNER_PLAN_REVIEW',  to: 'IMPLEMENTATION',        requiredToken: 'OWNER_IMPLEMENTATION_APPROVED' },
  { from: 'IMPLEMENTATION',     to: 'TEST' },
  { from: 'TEST',               to: 'OWNER_PRECOMMIT' },
  { from: 'OWNER_PRECOMMIT',    to: 'COMMIT',                requiredToken: 'OWNER_COMMIT_APPROVED' },
  { from: 'COMMIT',             to: 'PUSH',                  requiredToken: 'OWNER_PUSH_APPROVED' },
  { from: 'PUSH',               to: 'DEPLOY',                requiredToken: 'OWNER_DEPLOY_APPROVED' },
  { from: 'DEPLOY',             to: 'PRODUCTION_VALIDATION' },
  { from: 'PRODUCTION_VALIDATION', to: 'OWNER_FINAL_CLOSURE' },
  // Allow skipping straight to read-only validation without deployment (e.g. already deployed)
  { from: 'PUSH',               to: 'PRODUCTION_VALIDATION_READ_ONLY' },
  { from: 'PRODUCTION_VALIDATION', to: 'PRODUCTION_VALIDATION_READ_ONLY' },
  { from: 'PRODUCTION_VALIDATION_READ_ONLY', to: 'OWNER_FINAL_CLOSURE' },
] as const;

// ─── Owner Authority Event ─────────────────────────────────────────────────────

/**
 * The data fields of a canonical owner authority event.
 * Constructed only by TrustedOwnerAuthorityIssuer; validated only by OwnerEventProcessor.
 *
 * V1 trust: in-process structural brand (module-private Symbol).
 * V2 future: cryptographic signature from external authority service.
 */
export interface OwnerAuthorityEventFields {
  /** Unique event ID */
  readonly eventId: string;
  /** Owner identity reference */
  readonly ownerRef: string;
  /** Task/work-item this authority applies to */
  readonly taskId: string;
  /** The authority being granted */
  readonly authorityType: OwnerAuthorityToken;
  /**
   * Gate the grant is bound to.
   * Policy engine verifies gate matches before accepting the grant as sufficient.
   */
  readonly boundToGate?: ExecutionGate | undefined;
  /**
   * MutationClass action bound (e.g. 'GIT_COMMIT', 'GIT_PUSH', 'DEPLOYMENT').
   * The grant is only valid for actions matching this primary class.
   */
  readonly boundToAction?: string | undefined;
  readonly issuedAt: Date;
  /** V1 fixed source literal — only 'OWNER_EXPLICIT_REQUEST' is accepted. */
  readonly source: 'OWNER_EXPLICIT_REQUEST';
  readonly correlationId: string;
}

/**
 * Gate transition event data fields.
 */
export interface GateTransitionEventFields {
  readonly eventId: string;
  readonly ownerRef: string;
  readonly taskId: string;
  readonly fromGate: ExecutionGate;
  readonly toGate: ExecutionGate;
  readonly issuedAt: Date;
  readonly source: 'OWNER_EXPLICIT_REQUEST';
  readonly correlationId: string;
}

/**
 * Approved file scope event data fields.
 */
export interface ApprovedScopeEventFields {
  readonly eventId: string;
  readonly ownerRef: string;
  readonly taskId: string;
  readonly approvedFiles: readonly string[];
  readonly issuedAt: Date;
  readonly source: 'OWNER_EXPLICIT_REQUEST';
  readonly correlationId: string;
}

/**
 * Options for creating an OwnerEventProcessor.
 */
export interface OwnerEventProcessorOptions {
  readonly taskId: string;
  readonly initialGate: ExecutionGate;
  readonly environment: Environment;
}
