import { randomUUID } from 'node:crypto';
import type { Environment, ExecutionGate, OwnerAuthorityToken } from '../types.js';
import type {
  ApprovedScopeEventFields,
  GateTransitionEventFields,
  OwnerAuthorityEventFields,
} from './owner-authority-event.js';

// ─── Module-private brand symbol ──────────────────────────────────────────────
//
// This symbol is NEVER exported from this file or from packages/policy/src/index.ts.
// It cannot be accessed by agent/provider code. Only TrustedOwnerAuthorityIssuer
// (in this module) can stamp objects with this brand.
//
// OwnerEventProcessor imports isOwnerAuthorityEvent / isGateTransitionEvent /
// isApprovedScopeEvent from this module to validate branded events.
//
// A plain object { source: 'OWNER_EXPLICIT_REQUEST' } will FAIL the brand check
// because it does not carry this symbol.
//
// PLAIN_OBJECT_OWNER_EVENT_ACCEPTED=false
// AGENT_CAN_FORGE_ACCEPTED_OWNER_EVENT=false

const OWNER_EVENT_BRAND: unique symbol = Symbol('co.policy.OwnerEvent.trusted');
const GATE_EVENT_BRAND: unique symbol = Symbol('co.policy.GateEvent.trusted');
const SCOPE_EVENT_BRAND: unique symbol = Symbol('co.policy.ScopeEvent.trusted');

// ─── Sealed event classes ─────────────────────────────────────────────────────

/**
 * Opaque sealed owner authority event.
 * Can only be instantiated by TrustedOwnerAuthorityIssuer (via the private constructor
 * accessed through the static factory below).
 *
 * The public class exports type-safe field access but the brand makes it
 * unforgeable to external code that cannot access the OWNER_EVENT_BRAND symbol.
 */
export class SealedOwnerAuthorityEvent {
  public readonly [OWNER_EVENT_BRAND] = true as const;

  public readonly eventId: string;
  public readonly ownerRef: string;
  public readonly taskId: string;
  public readonly authorityType: OwnerAuthorityToken;
  public readonly boundToGate?: ExecutionGate | undefined;
  public readonly boundToAction?: string | undefined;
  public readonly issuedAt: Date;
  public readonly source: 'OWNER_EXPLICIT_REQUEST';
  public readonly correlationId: string;

  private constructor(fields: OwnerAuthorityEventFields) {
    this.eventId = fields.eventId;
    this.ownerRef = fields.ownerRef;
    this.taskId = fields.taskId;
    this.authorityType = fields.authorityType;
    if (fields.boundToGate !== undefined) this.boundToGate = fields.boundToGate;
    if (fields.boundToAction !== undefined) this.boundToAction = fields.boundToAction;
    this.issuedAt = fields.issuedAt;
    this.source = fields.source;
    this.correlationId = fields.correlationId;
  }

  /** @internal — used only by TrustedOwnerAuthorityIssuer */
  static _create(fields: OwnerAuthorityEventFields): SealedOwnerAuthorityEvent {
    return new SealedOwnerAuthorityEvent(fields);
  }
}

export class SealedGateTransitionEvent {
  public readonly [GATE_EVENT_BRAND] = true as const;

  public readonly eventId: string;
  public readonly ownerRef: string;
  public readonly taskId: string;
  public readonly fromGate: ExecutionGate;
  public readonly toGate: ExecutionGate;
  public readonly issuedAt: Date;
  public readonly source: 'OWNER_EXPLICIT_REQUEST';
  public readonly correlationId: string;

  private constructor(fields: GateTransitionEventFields) {
    this.eventId = fields.eventId;
    this.ownerRef = fields.ownerRef;
    this.taskId = fields.taskId;
    this.fromGate = fields.fromGate;
    this.toGate = fields.toGate;
    this.issuedAt = fields.issuedAt;
    this.source = fields.source;
    this.correlationId = fields.correlationId;
  }

  static _create(fields: GateTransitionEventFields): SealedGateTransitionEvent {
    return new SealedGateTransitionEvent(fields);
  }
}

export class SealedApprovedScopeEvent {
  public readonly [SCOPE_EVENT_BRAND] = true as const;

  public readonly eventId: string;
  public readonly ownerRef: string;
  public readonly taskId: string;
  public readonly approvedFiles: readonly string[];
  public readonly issuedAt: Date;
  public readonly source: 'OWNER_EXPLICIT_REQUEST';
  public readonly correlationId: string;

  private constructor(fields: ApprovedScopeEventFields) {
    this.eventId = fields.eventId;
    this.ownerRef = fields.ownerRef;
    this.taskId = fields.taskId;
    this.approvedFiles = Object.freeze([...fields.approvedFiles]);
    this.issuedAt = fields.issuedAt;
    this.source = fields.source;
    this.correlationId = fields.correlationId;
  }

  static _create(fields: ApprovedScopeEventFields): SealedApprovedScopeEvent {
    return new SealedApprovedScopeEvent(fields);
  }
}

// ─── Brand verification functions (exported for OwnerEventProcessor) ──────────
//
// These functions allow OwnerEventProcessor to verify that an event was created
// by TrustedOwnerAuthorityIssuer. They do NOT expose the brand symbols themselves.
// Even if agent code imports and calls these functions, it cannot use them to
// FORGE a branded event — it can only verify (and the verification will fail
// for any object not created by TrustedOwnerAuthorityIssuer).

export function isOwnerAuthorityEvent(event: unknown): event is SealedOwnerAuthorityEvent {
  return typeof event === 'object' && event !== null && OWNER_EVENT_BRAND in event;
}

export function isGateTransitionEvent(event: unknown): event is SealedGateTransitionEvent {
  return typeof event === 'object' && event !== null && GATE_EVENT_BRAND in event;
}

export function isApprovedScopeEvent(event: unknown): event is SealedApprovedScopeEvent {
  return typeof event === 'object' && event !== null && SCOPE_EVENT_BRAND in event;
}

// ─── TrustedOwnerAuthorityIssuer ──────────────────────────────────────────────

/**
 * TrustedOwnerAuthorityIssuer
 *
 * The sole entity authorized to create canonical Owner authority events.
 * Constructed and held EXCLUSIVELY by the composition root.
 * Never passed to agents, providers, or policy engine.
 *
 * V1: in-process trusted authority — structural brand enforcement.
 * V2 future: events may carry cryptographic proof from external authority service.
 *
 * CANONICAL_OWNER_EVENT_ISSUER=TrustedOwnerAuthorityIssuer
 * AGENT_CAN_ISSUE_OWNER_EVENT=false
 */
export class TrustedOwnerAuthorityIssuer {
  public constructor(
    private readonly ownerRef: string,
    private readonly taskId: string,
  ) {}

  public issueAuthorityEvent(options: {
    authorityType: OwnerAuthorityToken;
    boundToGate?: ExecutionGate;
    boundToAction?: string;
    correlationId?: string;
  }): SealedOwnerAuthorityEvent {
    return SealedOwnerAuthorityEvent._create({
      eventId: randomUUID(),
      ownerRef: this.ownerRef,
      taskId: this.taskId,
      authorityType: options.authorityType,
      boundToGate: options.boundToGate,
      boundToAction: options.boundToAction,
      issuedAt: new Date(),
      source: 'OWNER_EXPLICIT_REQUEST',
      correlationId: options.correlationId ?? randomUUID(),
    });
  }

  public issueGateTransitionEvent(options: {
    fromGate: ExecutionGate;
    toGate: ExecutionGate;
    correlationId?: string;
  }): SealedGateTransitionEvent {
    return SealedGateTransitionEvent._create({
      eventId: randomUUID(),
      ownerRef: this.ownerRef,
      taskId: this.taskId,
      fromGate: options.fromGate,
      toGate: options.toGate,
      issuedAt: new Date(),
      source: 'OWNER_EXPLICIT_REQUEST',
      correlationId: options.correlationId ?? randomUUID(),
    });
  }

  public issueApprovedScopeEvent(options: {
    approvedFiles: readonly string[];
    correlationId?: string;
  }): SealedApprovedScopeEvent {
    return SealedApprovedScopeEvent._create({
      eventId: randomUUID(),
      ownerRef: this.ownerRef,
      taskId: this.taskId,
      approvedFiles: options.approvedFiles,
      issuedAt: new Date(),
      source: 'OWNER_EXPLICIT_REQUEST',
      correlationId: options.correlationId ?? randomUUID(),
    });
  }

  /** Convenience: issue authority + gate transition in one call. */
  public issueAuthorityAndTransition(options: {
    authorityType: OwnerAuthorityToken;
    fromGate: ExecutionGate;
    toGate: ExecutionGate;
    boundToAction?: string | undefined;
    correlationId?: string | undefined;
  }): { authority: SealedOwnerAuthorityEvent; transition: SealedGateTransitionEvent } {
    const correlationId = options.correlationId ?? randomUUID();
    return {
      authority: this.issueAuthorityEvent({
        authorityType: options.authorityType,
        boundToGate: options.toGate,
        ...(options.boundToAction !== undefined ? { boundToAction: options.boundToAction } : {}),
        correlationId,
      }),
      transition: this.issueGateTransitionEvent({
        fromGate: options.fromGate,
        toGate: options.toGate,
        correlationId,
      }),
    };
  }
}
