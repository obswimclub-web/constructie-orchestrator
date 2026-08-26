import { randomUUID } from 'crypto';
import type { AgentBridge, WorkPackage, AgentRuntimeContext, AgentRunResult } from '@co/contracts';
import type { ProjectEvent } from '@co/domain';

export interface EventLedger {
  append(event: ProjectEvent): Promise<void>;
  getEvents(aggregateId: string): Promise<ProjectEvent[]>;
}

export type RunState = 'STARTING' | 'RUNNING' | 'EVALUATING' | 'REPAIRING' | 'WAITING_FOR_OWNER' | 'RECONCILING' | 'CLOSED' | 'BLOCKED';

export class RunCoordinator {
  public constructor(
    private readonly bridge: AgentBridge,
    private readonly ledger: EventLedger
  ) {}

  public async execute(
    initialWorkPackage: WorkPackage,
    workflowRunId: string,
    correlationId: string,
    projectId: string
  ): Promise<void> {
    let state: RunState = 'STARTING';
    let currentWp = initialWorkPackage;
    let attemptId = randomUUID();
    let revision = 1;

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
        await emit(state === 'STARTING' ? 'RUN_STARTED' : 'RUN_REPAIR_STARTED', { attemptId, workPackageId: currentWp.workPackageId });
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

        const result = await this.bridge.getResult(handle);
        await emit('RUN_COMPLETED', { attemptId, result });
        state = 'EVALUATING';

        const evalState = await this.evaluateResult(result);
        if (evalState === 'FAILED_REPAIRABLE') {
          state = 'REPAIRING';
          attemptId = randomUUID();
          currentWp = { ...currentWp, workPackageId: randomUUID(), objective: 'Repair: ' + currentWp.objective };
          await emit('EVALUATION_FAILED_REPAIRABLE', { attemptId });
        } else if (evalState === 'AMBIGUOUS_SIDE_EFFECT') {
          state = 'RECONCILING';
          await emit('EVALUATION_AMBIGUOUS_SIDE_EFFECT', { attemptId });
          break; // Exit loop, wait for canonical reconciliation event
        } else if (evalState === 'PASS_OWNER_DECISION_REQUIRED') {
          state = 'WAITING_FOR_OWNER';
          await emit('EVALUATION_OWNER_DECISION_REQUIRED', { attemptId });
          break; // Exit loop, wait for canonical owner event
        } else if (evalState === 'PASS') {
          state = 'CLOSED';
          await emit('RUN_CLOSED', { attemptId });
        } else {
          state = 'BLOCKED';
          await emit('RUN_BLOCKED', { attemptId, reason: evalState });
        }
      }
    }
  }

  public async resume(workflowRunId: string, event: ProjectEvent): Promise<void> {
    const events = await this.ledger.getEvents(workflowRunId);
    const lastAttemptId = events.reverse().find(e => (e.payload as any)?.attemptId) ? (events.find(e => (e.payload as any)?.attemptId)?.payload as any).attemptId : randomUUID();
    const revision = events.length;

    const emit = async (type: string, payload: any, revOffset: number) => {
      await this.ledger.append({
        id: randomUUID(),
        projectId: event.projectId,
        eventType: type,
        aggregateType: 'RUN',
        aggregateId: workflowRunId,
        aggregateRevision: revision + revOffset,
        actorType: 'ORCHESTRATOR',
        actorId: 'system',
        correlationId: event.correlationId,
        causationId: event.id,
        schemaVersion: 1,
        payload,
        occurredAt: new Date(),
      });
    };

    if (event.eventType === 'OWNER_APPROVAL_GRANTED') {
      await emit('RUN_RESUMED', { attemptId: lastAttemptId }, 1);
      await emit('RUN_CLOSED', { attemptId: lastAttemptId }, 2);
    } else if (event.eventType === 'RECONCILIATION_RESOLVED') {
      await emit('RECONCILIATION_COMPLETE', { attemptId: lastAttemptId }, 1);
      await emit('RUN_REPAIR_STARTED', { attemptId: randomUUID(), workPackageId: randomUUID() }, 2);
      // In a full system, this would then re-enter the loop. We emit the transition.
    }
  }

  private async evaluateResult(result: AgentRunResult): Promise<string> {
    if (result.summary.includes('FAIL_REPAIRABLE')) return 'FAILED_REPAIRABLE';
    if (result.summary.includes('AMBIGUOUS')) return 'AMBIGUOUS_SIDE_EFFECT';
    if (result.summary.includes('OWNER_DECISION')) return 'PASS_OWNER_DECISION_REQUIRED';
    if (result.status === 'FAILED') return 'FAILED_TERMINAL';
    return 'PASS';
  }
}
