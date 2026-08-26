import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, StaleProjectRevisionError, type ProjectEvent } from "@co/domain";
import { ProjectStore } from "@co/persistence";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const store = new ProjectStore(prisma);

function event(input: {
  id: string;
  projectId: string;
  revision: number;
  type: string;
  correlationId: string;
  payload: Record<string, unknown>;
}): ProjectEvent<Record<string, unknown>> {
  return {
    id: input.id,
    projectId: input.projectId,
    eventType: input.type,
    aggregateType: "PROJECT",
    aggregateId: input.projectId,
    aggregateRevision: input.revision,
    actorType: "ORCHESTRATOR",
    actorId: "orchestrator-core",
    correlationId: input.correlationId,
    causationId: null,
    schemaVersion: 1,
    payload: input.payload,
    occurredAt: new Date(),
  };
}

describe("ProjectStore", () => {
  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.projectEvent.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists project + event + outbox atomically", async () => {
    const projectId = randomUUID();
    const project = createProject({ id: projectId, slug: "alpha", name: "Alpha", now: new Date() });
    const created = await store.create({
      project,
      event: event({
        id: randomUUID(),
        projectId,
        revision: 1,
        type: "PROJECT_CREATED",
        correlationId: randomUUID(),
        payload: { slug: project.slug, name: project.name },
      }),
    });

    expect(created.revision).toBe(1);
    expect(await prisma.projectEvent.count({ where: { projectId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { projectId, status: "PENDING" } })).toBe(1);
  });

  it("rejects stale writes without creating event/outbox rows", async () => {
    const projectId = randomUUID();
    const project = createProject({ id: projectId, slug: "beta", name: "Beta", now: new Date() });
    await store.create({
      project,
      event: event({
        id: randomUUID(),
        projectId,
        revision: 1,
        type: "PROJECT_CREATED",
        correlationId: randomUUID(),
        payload: { slug: project.slug, name: project.name },
      }),
    });

    await store.rename({
      projectId,
      expectedRevision: 1,
      name: "Beta 2",
      event: event({
        id: randomUUID(),
        projectId,
        revision: 2,
        type: "PROJECT_RENAMED",
        correlationId: randomUUID(),
        payload: { name: "Beta 2" },
      }),
    });

    const eventsBefore = await prisma.projectEvent.count({ where: { projectId } });
    const outboxBefore = await prisma.outboxEvent.count({ where: { projectId } });

    await expect(
      store.rename({
        projectId,
        expectedRevision: 1,
        name: "Stale name",
        event: event({
          id: randomUUID(),
          projectId,
          revision: 2,
          type: "PROJECT_RENAMED",
          correlationId: randomUUID(),
          payload: { name: "Stale name" },
        }),
      }),
    ).rejects.toBeInstanceOf(StaleProjectRevisionError);

    expect(await prisma.projectEvent.count({ where: { projectId } })).toBe(eventsBefore);
    expect(await prisma.outboxEvent.count({ where: { projectId } })).toBe(outboxBefore);
    expect((await store.getById(projectId))?.name).toBe("Beta 2");
  });
});
