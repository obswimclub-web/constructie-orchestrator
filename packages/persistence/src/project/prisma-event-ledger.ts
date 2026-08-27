import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectEvent } from '@co/domain';

export class PrismaEventLedger {
  public constructor(private readonly prisma: PrismaClient) {}

  public async append(event: ProjectEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.projectEvent.create({
        data: {
          id: event.id,
          projectId: event.projectId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateRevision: event.aggregateRevision,
          actorType: event.actorType,
          actorId: event.actorId,
          correlationId: event.correlationId,
          causationId: event.causationId,
          schemaVersion: event.schemaVersion,
          payload: event.payload as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: event.id,
          projectId: event.projectId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload as Prisma.InputJsonValue,
          correlationId: event.correlationId,
        },
      });
    });
  }

  public async getEvents(aggregateId: string): Promise<ProjectEvent[]> {
    const rows = await this.prisma.projectEvent.findMany({
      where: { aggregateId },
      orderBy: { aggregateRevision: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      eventType: row.eventType,
      aggregateType: row.aggregateType as ProjectEvent['aggregateType'],
      aggregateId: row.aggregateId,
      aggregateRevision: row.aggregateRevision,
      actorType: row.actorType as ProjectEvent['actorType'],
      actorId: row.actorId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      occurredAt: row.occurredAt,
    }));
  }
}
