import { randomUUID } from 'crypto';
import type { ActionAuditLedger, AuditEntryProposed, AuditEntry } from '@co/policy';
import type { PrismaEventLedger } from './prisma-event-ledger.js';


export class PrismaActionAuditLedger implements ActionAuditLedger {
  private revision: number | null = null;

  private memoryEntries: AuditEntry[] = [];

  constructor(
    private readonly ledger: PrismaEventLedger,
    private readonly attemptId: string,
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly redactor?: { redact: (s: string) => string }
  ) {}

  private async getNextRevision(): Promise<number> {
    if (this.revision === null) {
      const events = this.ledger ? await this.ledger.getEvents(this.attemptId) : [];
      this.revision = events.length > 0 ? Math.max(...events.map(e => e.aggregateRevision)) : 0;
    }
    this.revision++;
    return this.revision;
  }

  public async recordProposed(entry: AuditEntryProposed): Promise<void> {
    const rev1 = await this.getNextRevision();
    if (this.ledger) if (this.ledger) if (this.ledger) if (this.ledger) await this.ledger.append({
      id: randomUUID(),
      projectId: this.projectId,
      eventType: 'HOST_ACTION_PROPOSED',
      aggregateType: 'ATTEMPT',
      aggregateId: this.attemptId,
      aggregateRevision: rev1,
      actorType: 'AGENT',
      actorId: entry.request.agentId,
      correlationId: entry.request.correlationId,
      causationId: entry.request.actionId,
      schemaVersion: 1,
      payload: { request: entry.request } as unknown as import("@prisma/client").Prisma.InputJsonValue,
      occurredAt: entry.proposedAt,
    });

    const rev2 = await this.getNextRevision();
    if (this.ledger) await this.ledger.append({
      id: randomUUID(),
      projectId: this.projectId,
      eventType: 'HOST_ACTION_POLICY_DECIDED',
      aggregateType: 'ATTEMPT',
      aggregateId: this.attemptId,
      aggregateRevision: rev2,
      actorType: 'SYSTEM',
      actorId: 'policy-engine',
      correlationId: entry.request.correlationId,
      causationId: entry.request.actionId,
      schemaVersion: 1,
      payload: { decision: entry.decision, classification: entry.classification } as unknown as import("@prisma/client").Prisma.InputJsonValue,
      occurredAt: new Date(),
    });
    this.memoryEntries.push({ ...entry, executedAt: undefined, executionResult: entry.decision.decision === 'DENY' ? 'NOT_EXECUTED' : undefined });

  }

  public async recordExecuted(actionId: string, result: import('@co/contracts').ToolExecutionResult): Promise<void> {
    const rev = await this.getNextRevision();
    const eventType = result.status === 'UNKNOWN' ? 'HOST_ACTION_RECONCILIATION_REQUIRED' : 'HOST_ACTION_EXECUTION_COMPLETED';

    const rawPayload = { actionId, result };
    const payload = this.redactor ? JSON.parse(this.redactor.redact(JSON.stringify(rawPayload))) : rawPayload;

    if (this.ledger) await this.ledger.append({
      id: randomUUID(),
      projectId: this.projectId,
      eventType,
      aggregateType: 'ATTEMPT',
      aggregateId: this.attemptId,
      aggregateRevision: rev,
      actorType: 'SYSTEM',
      actorId: 'gateway',
      correlationId: 'sys-corr',
      causationId: actionId,
      schemaVersion: 1,
      payload: payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
      occurredAt: new Date(),
    });

    const eIndex = this.memoryEntries.findIndex(x => x.actionId === actionId);
    if (eIndex !== -1) { this.memoryEntries[eIndex] = { ...this.memoryEntries[eIndex], executionResult: result, executedAt: new Date() } as unknown as import("@co/policy").AuditEntry; }
  }

  public async entries(): Promise<readonly AuditEntry[]> {
    // Only used for testing/in-memory checks usually.
    return this.memoryEntries;
  }
}
