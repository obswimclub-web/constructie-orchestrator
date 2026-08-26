import type { PrismaClient, Prisma } from "@prisma/client";
import {
  StaleProjectRevisionError,
  type Project,
  type ProjectEvent,
} from "@co/domain";

export interface CreateProjectPersistenceInput {
  readonly project: Project;
  readonly event: ProjectEvent<Record<string, unknown>>;
}

export interface RenameProjectPersistenceInput {
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly event: ProjectEvent<Record<string, unknown>>;
}

function mapProject(row: {
  id: string;
  slug: string;
  name: string;
  lifecycleState: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): Project {
  if (row.lifecycleState !== "ACTIVE" && row.lifecycleState !== "PAUSED" && row.lifecycleState !== "ARCHIVED") {
    throw new Error(`Unsupported persisted project lifecycle state: ${row.lifecycleState}`);
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    lifecycleState: row.lifecycleState,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProjectStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(input: CreateProjectPersistenceInput): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          id: input.project.id,
          slug: input.project.slug,
          name: input.project.name,
          lifecycleState: input.project.lifecycleState,
          revision: input.project.revision,
          createdAt: input.project.createdAt,
          updatedAt: input.project.updatedAt,
        },
      });

      await tx.projectEvent.create({
        data: {
          id: input.event.id,
          projectId: input.event.projectId,
          eventType: input.event.eventType,
          aggregateType: input.event.aggregateType,
          aggregateId: input.event.aggregateId,
          aggregateRevision: input.event.aggregateRevision,
          actorType: input.event.actorType,
          actorId: input.event.actorId,
          correlationId: input.event.correlationId,
          causationId: input.event.causationId,
          schemaVersion: input.event.schemaVersion,
          payload: input.event.payload as Prisma.InputJsonValue,
          occurredAt: input.event.occurredAt,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: input.event.id,
          projectId: input.event.projectId,
          eventType: input.event.eventType,
          aggregateType: input.event.aggregateType,
          aggregateId: input.event.aggregateId,
          payload: input.event.payload as Prisma.InputJsonValue,
          correlationId: input.event.correlationId,
        },
      });

      return mapProject(created);
    });
  }

  public async getById(projectId: string): Promise<Project | null> {
    const row = await this.prisma.project.findUnique({ where: { id: projectId } });
    return row === null ? null : mapProject(row);
  }

  public async rename(input: RenameProjectPersistenceInput): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const nextRevision = input.expectedRevision + 1;
      const updated = await tx.project.updateMany({
        where: {
          id: input.projectId,
          revision: input.expectedRevision,
        },
        data: {
          name: input.name,
          revision: nextRevision,
        },
      });

      if (updated.count !== 1) {
        throw new StaleProjectRevisionError(input.projectId, input.expectedRevision);
      }

      if (input.event.aggregateRevision !== nextRevision) {
        throw new Error(
          `Event revision ${input.event.aggregateRevision} does not match next project revision ${nextRevision}.`,
        );
      }

      await tx.projectEvent.create({
        data: {
          id: input.event.id,
          projectId: input.event.projectId,
          eventType: input.event.eventType,
          aggregateType: input.event.aggregateType,
          aggregateId: input.event.aggregateId,
          aggregateRevision: input.event.aggregateRevision,
          actorType: input.event.actorType,
          actorId: input.event.actorId,
          correlationId: input.event.correlationId,
          causationId: input.event.causationId,
          schemaVersion: input.event.schemaVersion,
          payload: input.event.payload as Prisma.InputJsonValue,
          occurredAt: input.event.occurredAt,
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: input.event.id,
          projectId: input.event.projectId,
          eventType: input.event.eventType,
          aggregateType: input.event.aggregateType,
          aggregateId: input.event.aggregateId,
          payload: input.event.payload as Prisma.InputJsonValue,
          correlationId: input.event.correlationId,
        },
      });

      const row = await tx.project.findUniqueOrThrow({ where: { id: input.projectId } });
      return mapProject(row);
    });
  }
}
