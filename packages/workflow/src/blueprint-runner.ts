import { RunCoordinator } from './run-coordinator.js';
import type { WorkPackage } from '@co/contracts';
import type { EventLedger } from './run-coordinator.js';
import { randomUUID } from 'crypto';

export class BlueprintRunner {
  constructor(
    private readonly coordinator: RunCoordinator,
    private readonly ledger: EventLedger,
    private readonly projectId: string
  ) {}

  public async executeBlueprint(
    blueprintId: string,
    workPackages: WorkPackage[]
  ): Promise<void> {
    const runId = randomUUID();

    await this.ledger.append({
      id: randomUUID(),
      projectId: this.projectId,
      eventType: 'BLUEPRINT_STARTED',
      aggregateType: 'PROJECT',
      aggregateId: blueprintId,
      aggregateRevision: 1,
      actorType: 'ORCHESTRATOR',
      actorId: 'system',
      correlationId: runId,
      causationId: null,
      schemaVersion: 1,
      payload: { blueprintId, workPackageCount: workPackages.length },
      occurredAt: new Date(),
    });

    let revision = 2;

    for (const wp of workPackages) {
      const taskRunId = randomUUID();
      await this.coordinator.execute(wp, taskRunId, runId, this.projectId);
      const events = await this.ledger.getEvents(taskRunId);
      const isClosed = events.some(e => e.eventType === 'RUN_CLOSED');

      if (!isClosed) {
        await this.ledger.append({
          id: randomUUID(),
          projectId: this.projectId,
          eventType: 'BLUEPRINT_BLOCKED',
          aggregateType: 'PROJECT',
          aggregateId: blueprintId,
          aggregateRevision: revision++,
          actorType: 'ORCHESTRATOR',
          actorId: 'system',
          correlationId: runId,
          causationId: null,
          schemaVersion: 1,
          payload: { reason: `Task ${wp.workPackageId} failed or blocked` },
          occurredAt: new Date(),
        });
        return;
      }
    }

    await this.ledger.append({
      id: randomUUID(),
      projectId: this.projectId,
      eventType: 'BLUEPRINT_COMPLETED',
      aggregateType: 'PROJECT',
      aggregateId: blueprintId,
      aggregateRevision: revision++,
      actorType: 'ORCHESTRATOR',
      actorId: 'system',
      correlationId: runId,
      causationId: null,
      schemaVersion: 1,
      payload: { blueprintId, status: 'COMPLETE' },
      occurredAt: new Date(),
    });
  }
}
