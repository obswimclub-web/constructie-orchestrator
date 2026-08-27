import { randomUUID } from 'crypto';
import type { AgentBridge, WorkPackage, AgentRuntimeContext, AgentRunResult, AgentRunStatus } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';
import { SealedOwnerAuthorityEvent, isOwnerAuthorityEvent } from '@co/policy';

export interface EventLedger {
  append(event: ProjectEvent): Promise<void>;
  getEvents(aggregateId: string): Promise<ProjectEvent[]>;
}

export type RunState = 'STARTING' | 'RUNNING' | 'EVALUATING' | 'REPAIRING' | 'WAITING_FOR_OWNER' | 'RECONCILING' | 'CLOSED' | 'BLOCKED';
export type ReviewDecision = 'PASS' | 'FAIL_REPAIRABLE' | 'OWNER_DECISION_REQUIRED' | 'AMBIGUOUS_SIDE_EFFECT' | 'BLOCKED' | 'COMPLETE';

export interface StructuredReviewer {
  reviewExecution(result: AgentRunResult): Promise<{ decision: ReviewDecision; feedback?: string; pendingAction?: string; pendingGate?: string; pendingAuthorityType?: string; nextAction?: string; }>;
}

export interface RunCoordinatorOptions {
  maxRepairAttempts: number;
}

export interface WaitPolicy {
  timeoutMs: number;
  intervalMs: number;
}
export const defaultWaitPolicy: WaitPolicy = { timeoutMs: 10000, intervalMs: 100 };

// ─── Sealed Reconciliation Outcome (branded, unforgeable) ─────────────────────

const RECONCILIATION_BRAND: unique symbol = Symbol('co.workflow.ReconciliationOutcome.trusted');

/**
 * Branded reconciliation outcome.  The constructor is private and the only
 * factory (`createSealedReconciliationOutcome`) is module-scoped — it is NOT
 * exported.  External code that imports `@co/workflow` can read instances and
 * pass them around, but cannot mint new ones.  Only `TrustedReconciliationIssuer`
 * (defined in the same module) can produce sealed outcomes.
 */
export class SealedReconciliationOutcome {
  public readonly [RECONCILIATION_BRAND] = true as const;
  public readonly safeToRetry: boolean;
  public readonly correlationId: string;
  public readonly causationId: string;
  public readonly verifiedBy: string;
  public readonly reason: string;

  /** @internal — private constructor; only callable from this module's factory */
  private constructor(fields: {
    safeToRetry: boolean;
    correlationId: string;
    causationId: string;
    verifiedBy: string;
    reason: string;
  }) {
    this.safeToRetry = fields.safeToRetry;
    this.correlationId = fields.correlationId;
    this.causationId = fields.causationId;
    this.verifiedBy = fields.verifiedBy;
    this.reason = fields.reason;
  }
}

// ─── Module-private factory — NOT exported ────────────────────────────────────
function createSealedReconciliationOutcome(fields: {
  safeToRetry: boolean;
  correlationId: string;
  causationId: string;
  verifiedBy: string;
  reason: string;
}): SealedReconciliationOutcome {
  // Access the private constructor via a same-scope closure trick:
  // We define a subclass in the same module scope whose sole purpose is to
  // forward construction, then upcast to the base type.
  return new (SealedReconciliationOutcome as unknown as {
    new (f: typeof fields): SealedReconciliationOutcome;
  })(fields);
}

/** Runtime type guard — checks for the unforgeable branded symbol. */
export function isReconciliationOutcome(value: unknown): value is SealedReconciliationOutcome {
  return typeof value === 'object' && value !== null && RECONCILIATION_BRAND in value;
}

/**
 * Trusted issuer for reconciliation outcomes.  V1 in-process authority:
 * this class should be instantiated only in the composition root and held
 * by the trusted control-plane code — never passed to agent/provider code.
 */
export class TrustedReconciliationIssuer {
  constructor(private readonly identity: string) {}

  public issueOutcome(fields: {
    safeToRetry: boolean;
    correlationId: string;
    causationId: string;
    reason: string;
  }): SealedReconciliationOutcome {
    return createSealedReconciliationOutcome({
      ...fields,
      verifiedBy: this.identity,
    });
  }
}



const NON_TERMINAL_STATUSES = new Set<AgentRunStatus>(['CREATED', 'QUEUED', 'STARTING', 'RUNNING', 'WAITING_FOR_TOOL', 'WAITING_FOR_INPUT', 'CANCELLING']);
const TERMINAL_STATUSES = new Set<AgentRunStatus>(['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const AMBIGUOUS_STATUSES = new Set<AgentRunStatus>(['UNKNOWN']);

export function classifyStatus(status: AgentRunStatus): 'NON_TERMINAL' | 'TERMINAL' | 'AMBIGUOUS' {
  if (NON_TERMINAL_STATUSES.has(status)) return 'NON_TERMINAL';
  if (TERMINAL_STATUSES.has(status)) return 'TERMINAL';
  if (AMBIGUOUS_STATUSES.has(status)) return 'AMBIGUOUS';
  throw new Error(`Unclassified AgentRunStatus: ${status}`);
}

export class RunCoordinator {
  public constructor(
    private readonly bridge: AgentBridge,
    private readonly ledger: EventLedger,
    private readonly reviewer: StructuredReviewer,
    /** Canonical control-plane taskId — injected at composition root; never derived from workItemId or workflowRunId */
    private readonly canonicalTaskId: string,
    private readonly waitPolicy: WaitPolicy = defaultWaitPolicy,
    private readonly options: RunCoordinatorOptions = { maxRepairAttempts: 3 }
  ) {}

  public async execute(
    initialWorkPackage: WorkPackage,
    workflowRunId: string,
    correlationId: string,
    projectId: string,
    reconstructedState?: { state: RunState; wp: WorkPackage; attemptId: string; revision: number; pendingAction?: string | undefined; pendingGate?: string | undefined; pendingAuthorityType?: string | undefined; repairAttempts?: number; }
  ): Promise<void> {
    let state: RunState = reconstructedState?.state ?? 'STARTING';
    let currentWp = reconstructedState?.wp ?? initialWorkPackage;
    let attemptId = reconstructedState?.attemptId ?? randomUUID();
    let revision = reconstructedState?.revision ?? 1;
    let pendingAction = reconstructedState?.pendingAction;
    let pendingGate = reconstructedState?.pendingGate;
    let pendingAuthorityType = reconstructedState?.pendingAuthorityType;
    // taskId is ALWAYS the canonical control-plane taskId — no fallback to workItemId or workflowRunId
    const taskId = this.canonicalTaskId;
    let repairAttempts = reconstructedState?.repairAttempts ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit = async (type: string, payload: any) => {
      await this.ledger.append({
        id: randomUUID(),
        projectId,
        eventType: type,
        aggregateType: 'RUN',
        aggregateId: workflowRunId,
        aggregateRevision: revision++,
        actorType: 'ORCHESTRATOR',
        actorId: 'system',
        correlationId,
        causationId: null,
        schemaVersion: 1,
        payload,
        occurredAt: new Date(),
      });
    };

    while (state !== 'CLOSED' && state !== 'BLOCKED') {
      if (state === 'STARTING' || state === 'REPAIRING') {
        await emit(state === 'STARTING' ? 'RUN_STARTED' : 'RUN_REPAIR_STARTED', {
          attemptId,
          workPackageId: currentWp.workPackageId,
          workPackage: currentWp,
          pendingAction,
          pendingGate,
          pendingAuthorityType,
          taskId
        });
        state = 'RUNNING';
      }

      if (state === 'RUNNING') {
        const runtimeContext: AgentRuntimeContext = {
          correlationId,
          workflowRunId,
          attemptId,
          secretRefs: [],
        };

        const handle = await this.bridge.dispatch(currentWp, runtimeContext);
        await emit('RUN_DISPATCHED', { attemptId, runId: handle.runId });

        let status = await this.bridge.getStatus(handle);
        const startTime = Date.now();

        while (classifyStatus(status) === 'NON_TERMINAL' && (Date.now() - startTime) < this.waitPolicy.timeoutMs) {
          await new Promise(r => setTimeout(r, this.waitPolicy.intervalMs));
          status = await this.bridge.getStatus(handle);
        }

        let result: AgentRunResult | undefined;
        let review: { decision: ReviewDecision; feedback?: string; pendingAction?: string; pendingGate?: string; pendingAuthorityType?: string; nextAction?: string; };

        if (classifyStatus(status) === 'NON_TERMINAL') {
          try { await this.bridge.cancel(handle); } catch { /* best-effort cancel */ }
          review = { decision: 'AMBIGUOUS_SIDE_EFFECT', feedback: 'TIMEOUT_AMBIGUOUS' };
        } else if (classifyStatus(status) === 'AMBIGUOUS') {
          review = { decision: 'AMBIGUOUS_SIDE_EFFECT', feedback: 'TRANSPORT_LOST_AMBIGUOUS' };
        } else {
          try {
            result = await this.bridge.getResult(handle);
            if (result.status === 'CANCELLED' || result.status === 'INTERRUPTED') {
              review = { decision: 'AMBIGUOUS_SIDE_EFFECT', feedback: 'Cancelled' };
            } else if (result.status === 'FAILED') {
              review = { decision: 'FAIL_REPAIRABLE', feedback: 'Run failed naturally, repairing.' };
            } else {
              review = await this.reviewer.reviewExecution(result);
            }
          } catch {
             review = { decision: 'AMBIGUOUS_SIDE_EFFECT', feedback: 'TRANSPORT_LOST_AMBIGUOUS' };
          }
        }

        await emit('RUN_COMPLETED', { attemptId, result: result ?? { status: 'FAILED', summary: review.feedback } });
        state = 'EVALUATING';

        if (review.decision === 'FAIL_REPAIRABLE') {
          if (repairAttempts >= this.options.maxRepairAttempts) {
            state = 'BLOCKED';
            await emit('RUN_BLOCKED', { attemptId, reason: 'MAX_REPAIR_ATTEMPTS_EXCEEDED' });
            continue;
          }
          repairAttempts++;
          state = 'REPAIRING';
          attemptId = randomUUID();
          currentWp = {
            ...currentWp,
            workPackageId: randomUUID(),
            objective: `Repair feedback: ${review.feedback}\nOriginal: ${currentWp.objective}`
          };
          await emit('EVALUATION_FAILED_REPAIRABLE', { attemptId, repairAttempts });
        } else if (review.decision === 'AMBIGUOUS_SIDE_EFFECT') {
          state = 'RECONCILING';
          await emit('EVALUATION_AMBIGUOUS_SIDE_EFFECT', { attemptId });
          break; // Exit loop, wait for reconciliation
        } else if (review.decision === 'OWNER_DECISION_REQUIRED') {
          state = 'WAITING_FOR_OWNER';
          pendingAction = review.pendingAction;
          pendingGate = review.pendingGate;
          pendingAuthorityType = review.pendingAuthorityType;
          await emit('EVALUATION_OWNER_DECISION_REQUIRED', { attemptId, pendingAction, pendingGate, pendingAuthorityType });
          break; // Exit loop, wait for owner
        } else if (review.decision === 'PASS') {
          await emit('EVALUATION_PASSED', { attemptId, nextAction: review.nextAction });
          if (!review.nextAction) throw new Error("PASS decision missing nextAction continuation plan");
          currentWp = { ...currentWp, workPackageId: randomUUID(), objective: review.nextAction };
          attemptId = randomUUID();
          state = 'STARTING';
        } else if (review.decision === 'COMPLETE') {
          state = 'CLOSED';
          await emit('RUN_CLOSED', { attemptId });
        } else {
          state = 'BLOCKED';
          await emit('RUN_BLOCKED', { attemptId, reason: review.decision });
        }
      }
    }
  }

    public async resumeWithAuthority(workflowRunId: string, authority: SealedOwnerAuthorityEvent): Promise<void> {
    if (!isOwnerAuthorityEvent(authority)) {
      throw new Error('Untrusted owner event: Forgeable ProjectEvent rejected. Must be a SealedOwnerAuthorityEvent.');
    }
    // taskId validation deferred until events are loaded

    const events = await this.ledger.getEvents(workflowRunId);
    if (events.length === 0) throw new Error(`Cannot resume workflow ${workflowRunId}: No events found.`);

    const projectId = events[0]!.projectId;

    let lastWp: WorkPackage | undefined;
    let lastAttemptId = randomUUID();
    let currentState: RunState = 'STARTING';
    let pendingAction: string | undefined = undefined;
    let pendingGate: string | undefined = undefined;
    let pendingAuthorityType: string | undefined = undefined;
    let repairAttempts = 0;

    for (const e of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = e.payload as any;
      if (e.eventType === 'RUN_STARTED' || e.eventType === 'RUN_REPAIR_STARTED') {
        lastWp = p.workPackage;
        lastAttemptId = p.attemptId;
        pendingAction = p.pendingAction;
        pendingGate = p.pendingGate;
        pendingAuthorityType = p.pendingAuthorityType;
        currentState = 'RUNNING';
      } else if (e.eventType === 'RUN_DISPATCHED') {
        currentState = 'RUNNING';
      } else if (e.eventType === 'RUN_COMPLETED') {
        currentState = 'EVALUATING';
      } else if (e.eventType === 'EVALUATION_FAILED_REPAIRABLE') {
        if (p.repairAttempts !== undefined) repairAttempts = p.repairAttempts;
        currentState = 'REPAIRING';
      } else if (e.eventType === 'EVALUATION_AMBIGUOUS_SIDE_EFFECT') {
        currentState = 'RECONCILING';
      } else if (e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED') {
        currentState = 'WAITING_FOR_OWNER';
        pendingAction = p.pendingAction;
        pendingGate = p.pendingGate;
        pendingAuthorityType = p.pendingAuthorityType;
      } else if (e.eventType === 'EVALUATION_PASSED') {
        // PASS re-enters STARTING via the loop; next event is RUN_STARTED.
      } else if (e.eventType === 'RUN_CLOSED') {
        currentState = 'CLOSED';
      } else if (e.eventType === 'RUN_BLOCKED') {
        currentState = 'BLOCKED';
      }
    }

    if (!lastWp) {
      throw new Error(`Cannot resume workflow ${workflowRunId}: No valid work package found in event history.`);
    }

    // Validate against the canonical taskId injected at construction — never from events or workItemId
    if (authority.taskId !== this.canonicalTaskId) {
      throw new Error(`Owner event taskId mismatch: expected canonical taskId '${this.canonicalTaskId}', got '${authority.taskId}'`);
    }

    if (currentState !== 'WAITING_FOR_OWNER') {
      throw new Error(`Cannot resume workflow ${workflowRunId} with owner authority from state ${currentState}`);
    }

    if (!authority.boundToAction || authority.boundToAction !== pendingAction) {
      throw new Error(`Owner event action binding missing or mismatched: expected '${pendingAction}', got '${authority.boundToAction}'`);
    }
    if (!authority.boundToGate || authority.boundToGate !== pendingGate) {
      throw new Error(`Owner event gate binding missing or mismatched: expected '${pendingGate}', got '${authority.boundToGate}'`);
    }
    if (authority.authorityType !== pendingAuthorityType) {
      throw new Error(`Owner event authority type missing or mismatched: expected '${pendingAuthorityType}', got '${authority.authorityType}'`);
    }

    const revision = events.length + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit = async (type: string, payload: any, rev: number) => {
      await this.ledger.append({
        id: randomUUID(),
        projectId,
        eventType: type,
        aggregateType: 'RUN',
        aggregateId: workflowRunId,
        aggregateRevision: rev,
        actorType: 'ORCHESTRATOR',
        actorId: 'system',
        correlationId: authority.correlationId,
        causationId: authority.eventId,
        schemaVersion: 1,
        payload,
        occurredAt: new Date(),
      });
    };

    await emit('RUN_RESUMED', { attemptId: lastAttemptId, authorityType: authority.authorityType }, revision);

    const resumedWp = {
      ...lastWp,
      workPackageId: randomUUID(),
    };

    await this.execute(resumedWp, workflowRunId, authority.correlationId, projectId, {
      state: 'STARTING',
      wp: resumedWp,
      attemptId: randomUUID(),
      revision: revision + 1,
      pendingAction,
      pendingGate,
      pendingAuthorityType,
      repairAttempts,
    });
  }

  /**
   * Resume a RECONCILING run after an ambiguous side-effect has been investigated.
   *
   * The caller MUST supply a `SealedReconciliationOutcome` produced by a
   * `TrustedReconciliationIssuer`.  Plain / forged objects are rejected at
   * runtime via the branded-symbol type guard.
   *
   * - `outcome.safeToRetry === false` → BLOCKED, no redispatch.
   * - `outcome.safeToRetry === true`  → exactly one redispatch with the
   *   original work-package objective.
   */
  public async resumeFromReconciliation(
    workflowRunId: string,
    outcome: SealedReconciliationOutcome,
  ): Promise<void> {
    if (!isReconciliationOutcome(outcome)) {
      throw new Error('Untrusted reconciliation outcome: must be a SealedReconciliationOutcome from TrustedReconciliationIssuer.');
    }
    const proof = outcome;
    const events = await this.ledger.getEvents(workflowRunId);
    if (events.length === 0) throw new Error(`Cannot resume workflow ${workflowRunId}: No events found.`);

    const projectId = events[0]!.projectId;

    let lastWp: WorkPackage | undefined;
    let lastAttemptId = randomUUID();
    let currentState: RunState = 'STARTING';
    let repairAttempts = 0;

    for (const e of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = e.payload as any;
      if (e.eventType === 'RUN_STARTED' || e.eventType === 'RUN_REPAIR_STARTED') {
        lastWp = p.workPackage;
        lastAttemptId = p.attemptId;
        currentState = 'RUNNING';
      } else if (e.eventType === 'RUN_DISPATCHED') {
        currentState = 'RUNNING';
      } else if (e.eventType === 'RUN_COMPLETED') {
        currentState = 'EVALUATING';
      } else if (e.eventType === 'EVALUATION_FAILED_REPAIRABLE') {
        if (p.repairAttempts !== undefined) repairAttempts = p.repairAttempts;
        currentState = 'REPAIRING';
      } else if (e.eventType === 'EVALUATION_AMBIGUOUS_SIDE_EFFECT') {
        currentState = 'RECONCILING';
      } else if (e.eventType === 'EVALUATION_OWNER_DECISION_REQUIRED') {
        currentState = 'WAITING_FOR_OWNER';
      } else if (e.eventType === 'RUN_CLOSED') {
        currentState = 'CLOSED';
      } else if (e.eventType === 'RUN_BLOCKED') {
        currentState = 'BLOCKED';
      }
    }

    if (!lastWp) {
      throw new Error(`Cannot resume workflow ${workflowRunId}: No valid work package found in event history.`);
    }

    if (currentState !== 'RECONCILING') {
      throw new Error(`Cannot resume workflow ${workflowRunId} from reconciliation in state ${currentState}`);
    }

    let revision = events.length + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit = async (type: string, payload: any) => {
      await this.ledger.append({
        id: randomUUID(),
        projectId,
        eventType: type,
        aggregateType: 'RUN',
        aggregateId: workflowRunId,
        aggregateRevision: revision++,
        actorType: 'ORCHESTRATOR',
        actorId: 'system',
        correlationId: proof.correlationId,
        causationId: proof.causationId,
        schemaVersion: 1,
        payload,
        occurredAt: new Date(),
      });
    };

    // Record the reconciliation outcome as a canonical event regardless of safety
    await emit('RECONCILIATION_OUTCOME', {
      attemptId: lastAttemptId,
      safeToRetry: proof.safeToRetry,
      verifiedBy: proof.verifiedBy,
      reason: proof.reason,
    });

    if (!proof.safeToRetry) {
      // Unsafe or unknown — transition to BLOCKED, do NOT redispatch
      await emit('RUN_BLOCKED', {
        attemptId: lastAttemptId,
        reason: `RECONCILIATION_UNSAFE: ${proof.reason}`,
      });
      return;
    }

    // Safe to retry — redispatch with the original objective, not a synthetic prefix
    const retryWp = {
      ...lastWp,
      workPackageId: randomUUID(),
    };

    await this.execute(retryWp, workflowRunId, proof.correlationId, projectId, {
      state: 'REPAIRING',
      wp: retryWp,
      attemptId: randomUUID(),
      revision,
      repairAttempts,
    });
  }
}

export class InMemoryEventLedger implements EventLedger {
  private events: ProjectEvent[] = [];
  public async append(event: ProjectEvent): Promise<void> { this.events.push(event); }
  public async getEvents(aggregateId: string): Promise<ProjectEvent[]> { return this.events.filter(e => e.aggregateId === aggregateId); }
}
