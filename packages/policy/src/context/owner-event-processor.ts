import type {
  AuthorityGrantStatus,
  AuthorityGrantView,
  Environment,
  ExecutionGate,
  OwnerAuthorityToken,
  OwnerGrantConsumer,
} from '../types.js';
import { GATE_TRANSITION_POLICY } from './owner-authority-event.js';
import type { OwnerEventProcessorOptions } from './owner-authority-event.js';
import type { ReadOnlyExecutionContext } from './read-only-execution-context.js';
import {
  isApprovedScopeEvent,
  isGateTransitionEvent,
  isOwnerAuthorityEvent,
  type SealedApprovedScopeEvent,
  type SealedGateTransitionEvent,
  type SealedOwnerAuthorityEvent,
} from './trusted-owner-authority-issuer.js';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class UntrustedOwnerEventError extends Error {
  public readonly code = 'UNTRUSTED_OWNER_EVENT';
  public constructor(detail: string) {
    super(`Untrusted owner event rejected: ${detail}`);
    this.name = 'UntrustedOwnerEventError';
  }
}

export class GateTransitionNotPermittedError extends Error {
  public readonly code = 'GATE_TRANSITION_NOT_PERMITTED';
  public constructor(from: ExecutionGate, to: ExecutionGate, reason: string) {
    super(`Gate transition ${from} → ${to} is not permitted: ${reason}`);
    this.name = 'GateTransitionNotPermittedError';
  }
}

export class TaskMismatchError extends Error {
  public readonly code = 'TASK_MISMATCH';
  public constructor(expected: string, received: string) {
    super(`Event taskId '${received}' does not match context taskId '${expected}'`);
    this.name = 'TaskMismatchError';
  }
}

export class GrantNotFoundError extends Error {
  public readonly code = 'GRANT_NOT_FOUND';
  public constructor(token: OwnerAuthorityToken, actionId?: string) {
    super(`Grant for token '${token}' not found${actionId ? ` (actionId: ${actionId})` : ''}`);
    this.name = 'GrantNotFoundError';
  }
}

// ─── Internal grant record ────────────────────────────────────────────────────

interface GrantRecord {
  token: OwnerAuthorityToken;
  taskId: string;
  status: AuthorityGrantStatus;
  reservedForActionId?: string | undefined;
  boundToGate?: ExecutionGate | undefined;
  boundToAction?: string | undefined;
  issuedAt: Date;
}

// ─── OwnerEventProcessor ──────────────────────────────────────────────────────

/**
 * OwnerEventProcessor
 *
 * ROLE: validates branded events from TrustedOwnerAuthorityIssuer and applies
 *       them to the mutable execution context state.
 *
 * INVARIANTS:
 *   - Events without the module-private brand are rejected (UntrustedOwnerEventError).
 *   - taskId must match the processor's taskId (TaskMismatchError).
 *   - Gate transitions must follow GATE_TRANSITION_POLICY.
 *   - Gate transitions that require a token verify the token is ACTIVE first.
 *   - Gate transitions do NOT consume grants (consumed by OwnerGrantConsumer after action).
 *
 * CAPABILITY SEPARATION:
 *   readOnlyView      → agents and policy engine (no mutation methods, immutable snapshots)
 *   asGrantConsumer() → GovernedToolGateway only (post-execution grant lifecycle)
 *   OwnerEventProcessor itself → composition root only; never passed to agents
 *
 * Authority Grant State Machine:
 *   ACTIVE → RESERVED(actionId) → CONSUMED               (on SUCCEEDED)
 *                                → ACTIVE                 (on CANCELLED/PROVEN_NOT_EXECUTED)
 *                                → RECONCILIATION_REQUIRED (on TIMED_OUT/FAILED/UNKNOWN)
 */
export class OwnerEventProcessor {
  private readonly _taskId: string;
  private _gate: ExecutionGate;
  private _environment: Environment;
  private readonly _grants: Map<string, GrantRecord> = new Map(); // key = eventId
  private readonly _approvedFileScope: Set<string> = new Set();
  private readonly _auditLog: Array<{ at: Date; event: string }> = [];

  public constructor(options: OwnerEventProcessorOptions) {
    this._taskId = options.taskId;
    this._gate = options.initialGate;
    this._environment = options.environment;
    this._auditLog.push({ at: new Date(), event: `GATE_INIT:${this._gate}` });
  }

  // ─── Read-only view ────────────────────────────────────────────────────────

  /**
   * The sole read-only surface passed to agents and the policy engine.
   * All collection accessors return new snapshots — no mutable references escape.
   * This getter returns a stable object whose methods close over the processor instance.
   */
  public get readOnlyView(): ReadOnlyExecutionContext {
    // Return a stable object bound to `this` via closures.
    // Re-creating on each access is intentional: callers should store the reference.
    const self = this;
    return {
      get gate() { return self._gate; },
      get environment() { return self._environment; },
      get approvedFiles(): readonly string[] { return [...self._approvedFileScope]; },
      get activeAuthorities(): readonly AuthorityGrantView[] {
        return [...self._grants.values()].map(g => ({
          token: g.token,
          taskId: g.taskId,
          status: g.status,
          reservedForActionId: g.reservedForActionId,
          boundToGate: g.boundToGate,
          boundToAction: g.boundToAction,
          issuedAt: g.issuedAt,
        }));
      },
      hasAuthority(token: OwnerAuthorityToken): boolean {
        return self._hasActiveGrant(token);
      },
      isFileApproved(filePath: string): boolean {
        return self._approvedFileScope.has(filePath);
      },
      auditLog(): readonly { at: Date; event: string }[] {
        return [...self._auditLog];
      },
    };
  }

  // ─── Grant consumer (gateway-only) ────────────────────────────────────────

  /**
   * Returns the OwnerGrantConsumer capability for GovernedToolGateway only.
   * Must NOT be passed to agents, providers, or policy engine.
   */
  public asGrantConsumer(): OwnerGrantConsumer {
    return {
      reserveGrant:         (token, actionId) => this._reserveGrant(token, actionId),
      consumeGrant:         (token, actionId) => this._consumeGrant(token, actionId),
      releaseGrantForRetry: (token, actionId) => this._releaseGrantForRetry(token, actionId),
      requireReconciliation:(token, actionId) => this._requireReconciliation(token, actionId),
    };
  }

  // ─── Control-plane mutations (composition root only) ──────────────────────

  /**
   * Apply a trusted authority event — ACTIVE grant is created.
   * Rejects any unbranded or task-mismatched event.
   */
  public applyOwnerAuthorityEvent(event: SealedOwnerAuthorityEvent): void {
    if (!isOwnerAuthorityEvent(event)) {
      throw new UntrustedOwnerEventError('Event does not carry required trusted issuer brand');
    }
    if (event.taskId !== this._taskId) {
      throw new TaskMismatchError(this._taskId, event.taskId);
    }
    this._grants.set(event.eventId, {
      token: event.authorityType,
      taskId: event.taskId,
      status: 'ACTIVE',
      boundToGate: event.boundToGate,
      boundToAction: event.boundToAction,
      issuedAt: event.issuedAt,
    });
    this._auditLog.push({ at: new Date(), event: `AUTHORITY_GRANTED:${event.authorityType}:${event.eventId}` });
  }

  /**
   * Apply a trusted gate transition event.
   * Validates: brand, taskId, transition policy, required token presence (NOT consumed).
   * Advances the gate. The required token remains ACTIVE for the authorized action.
   */
  public transitionGateFromEvent(event: SealedGateTransitionEvent): void {
    if (!isGateTransitionEvent(event)) {
      throw new UntrustedOwnerEventError('Gate transition event does not carry required trusted issuer brand');
    }
    if (event.taskId !== this._taskId) {
      throw new TaskMismatchError(this._taskId, event.taskId);
    }
    const rule = GATE_TRANSITION_POLICY.find(r => r.from === event.fromGate && r.to === event.toGate);
    if (!rule) {
      throw new GateTransitionNotPermittedError(
        event.fromGate, event.toGate, 'Transition not defined in GATE_TRANSITION_POLICY',
      );
    }
    if (event.fromGate !== this._gate) {
      throw new GateTransitionNotPermittedError(
        event.fromGate, event.toGate,
        `Current gate is '${this._gate}', event expects fromGate '${event.fromGate}'`,
      );
    }
    if (rule.requiredToken && !this._hasActiveGrant(rule.requiredToken)) {
      throw new GateTransitionNotPermittedError(
        event.fromGate, event.toGate,
        `Required token '${rule.requiredToken}' is not ACTIVE — cannot advance gate`,
      );
    }
    // Token verified ACTIVE but NOT consumed here.
    const previous = this._gate;
    this._gate = event.toGate;
    this._auditLog.push({ at: new Date(), event: `GATE_TRANSITION:${previous}→${this._gate}` });
  }

  /**
   * Set the approved file scope from a trusted scope event.
   * Replaces any previous scope.
   */
  public setApprovedScopeFromPlan(event: SealedApprovedScopeEvent): void {
    if (!isApprovedScopeEvent(event)) {
      throw new UntrustedOwnerEventError('Scope event does not carry required trusted issuer brand');
    }
    if (event.taskId !== this._taskId) {
      throw new TaskMismatchError(this._taskId, event.taskId);
    }
    this._approvedFileScope.clear();
    for (const f of event.approvedFiles) this._approvedFileScope.add(f);
    this._auditLog.push({ at: new Date(), event: `FILE_SCOPE_SET:${event.approvedFiles.length} files` });
  }

  /**
   * Explicitly revoke an ACTIVE or RESERVED grant (owner cancellation).
   * Composition root only.
   */
  public revokeGrant(token: OwnerAuthorityToken): void {
    for (const [id, record] of this._grants) {
      if (record.token === token && (record.status === 'ACTIVE' || record.status === 'RESERVED' || record.status === 'ISSUED')) {
        record.status = 'CONSUMED';
        this._auditLog.push({ at: new Date(), event: `AUTHORITY_REVOKED:${token}:${id}` });
        return;
      }
    }
  }

  // ─── Grant state machine implementation ────────────────────────────────────

  private _hasActiveGrant(token: OwnerAuthorityToken): boolean {
    for (const record of this._grants.values()) {
      if (record.token === token && record.status === 'ACTIVE') return true;
    }
    return false;
  }

  private _findActiveGrant(token: OwnerAuthorityToken): [string, GrantRecord] | undefined {
    for (const [id, record] of this._grants) {
      if (record.token === token && record.status === 'ACTIVE') return [id, record];
    }
    return undefined;
  }

  private _findReservedGrant(token: OwnerAuthorityToken, actionId: string): [string, GrantRecord] | undefined {
    for (const [id, record] of this._grants) {
      if (record.token === token && record.status === 'RESERVED' && record.reservedForActionId === actionId) {
        return [id, record];
      }
    }
    return undefined;
  }

  /** ACTIVE → RESERVED(actionId). Called before adapter.executeAuthorized(). */
  private _reserveGrant(token: OwnerAuthorityToken, actionId: string): void {
    const entry = this._findActiveGrant(token);
    if (!entry) throw new GrantNotFoundError(token, actionId);
    const [id, record] = entry;
    record.status = 'RESERVED';
    record.reservedForActionId = actionId;
    this._auditLog.push({ at: new Date(), event: `GRANT_RESERVED:${token}:${id}:actionId=${actionId}` });
  }

  /** RESERVED → CONSUMED. Called after confirmed SUCCEEDED execution. */
  private _consumeGrant(token: OwnerAuthorityToken, actionId: string): void {
    const entry = this._findReservedGrant(token, actionId);
    if (!entry) throw new GrantNotFoundError(token, actionId);
    const [id, record] = entry;
    record.status = 'CONSUMED';
    this._auditLog.push({ at: new Date(), event: `GRANT_CONSUMED:${token}:${id}:actionId=${actionId}` });
  }

  /** RESERVED → ACTIVE. Called after CANCELLED / PROVEN_NOT_EXECUTED. */
  private _releaseGrantForRetry(token: OwnerAuthorityToken, actionId: string): void {
    const entry = this._findReservedGrant(token, actionId);
    if (!entry) throw new GrantNotFoundError(token, actionId);
    const [id, record] = entry;
    record.status = 'ACTIVE';
    delete record.reservedForActionId;
    this._auditLog.push({ at: new Date(), event: `GRANT_RELEASED_FOR_RETRY:${token}:${id}:actionId=${actionId}` });
  }

  /** RESERVED → RECONCILIATION_REQUIRED. Called after TIMED_OUT / FAILED / UNKNOWN. */
  private _requireReconciliation(token: OwnerAuthorityToken, actionId: string): void {
    const entry = this._findReservedGrant(token, actionId);
    if (!entry) throw new GrantNotFoundError(token, actionId);
    const [id, record] = entry;
    record.status = 'RECONCILIATION_REQUIRED';
    this._auditLog.push({ at: new Date(), event: `GRANT_RECONCILIATION_REQUIRED:${token}:${id}:actionId=${actionId}` });
  }
}
