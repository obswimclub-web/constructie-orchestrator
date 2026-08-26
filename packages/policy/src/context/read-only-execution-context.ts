import type {
  AuthorityGrantView,
  Environment,
  ExecutionGate,
  OwnerAuthorityToken,
} from '../types.js';

/**
 * ReadOnlyExecutionContext
 *
 * The sole capability surface available to agents, providers, and the policy engine
 * for reading execution context state.
 *
 * INVARIANT: this interface exposes NO mutation methods.
 * All fields returning collections return immutable snapshots (new arrays on each call),
 * never references to the underlying mutable collections.
 *
 * Capability graph:
 *   OwnerEventProcessor → exposes readOnlyView: ReadOnlyExecutionContext
 *   ActionClassifyingPolicyEngine receives ReadOnlyExecutionContext (no mutations)
 *   CodexAdapter / AgentAdapters receive ReadOnlyExecutionContext (no mutations)
 *   OwnerEventProcessor is NOT passed to agents or policy engine
 */
export interface ReadOnlyExecutionContext {
  /** Current execution gate. */
  readonly gate: ExecutionGate;

  /** Current environment. */
  readonly environment: Environment;

  /**
   * Immutable snapshot of approved file paths for the current gate/plan.
   * A new array is returned on each call — no reference to internal state escapes.
   */
  readonly approvedFiles: readonly string[];

  /**
   * Immutable snapshot of all active authority grants.
   * A new array is returned on each call.
   * Only grants with status ACTIVE or RESERVED are meaningful for policy decisions.
   */
  readonly activeAuthorities: readonly AuthorityGrantView[];

  /**
   * Returns true if the given authority token is currently ACTIVE (not RESERVED,
   * not CONSUMED, not RECONCILIATION_REQUIRED).
   */
  hasAuthority(token: OwnerAuthorityToken): boolean;

  /**
   * Returns true if the given file path is in the current approved file scope.
   */
  isFileApproved(filePath: string): boolean;

  /**
   * Immutable snapshot of the audit log.
   */
  auditLog(): readonly { at: Date; event: string }[];
}
