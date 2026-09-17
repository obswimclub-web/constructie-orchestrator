/**
 * F-016 Regression: Enforce single ProjectEvent per aggregate revision.
 *
 * Requires a real PostgreSQL connection (uses DATABASE_URL env or default).
 * Tests that no two events — regardless of eventType — can share the same
 * (aggregateId, aggregateRevision) pair.
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaEventLedger } from '../../packages/persistence/src/project/prisma-event-ledger.js';
import type { ProjectEvent } from '@co/domain';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/orchestrator',
  password: 'postgres',
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const ledger = new PrismaEventLedger(prisma);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureProject(projectId: string): Promise<void> {
  await prisma.project.upsert({
    where: { id: projectId },
    create: {
      id: projectId,
      slug: `proj-${projectId.slice(0, 8)}`,
      name: `Test project ${projectId.slice(0, 8)}`,
      lifecycleState: 'ACTIVE',
      revision: 1,
    },
    update: {},
  });
}

function makeEvent(opts: {
  id?: string;
  projectId: string;
  aggregateId: string;
  aggregateRevision: number;
  eventType: string;
}): ProjectEvent {
  return {
    id: opts.id ?? randomUUID(),
    projectId: opts.projectId,
    eventType: opts.eventType,
    aggregateType: 'RUN',
    aggregateId: opts.aggregateId,
    aggregateRevision: opts.aggregateRevision,
    actorType: 'ORCHESTRATOR',
    actorId: 'test-orchestrator',
    correlationId: randomUUID(),
    causationId: null,
    schemaVersion: 1,
    payload: { test: true },
    occurredAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await prisma.outboxEvent.deleteMany();
  await prisma.projectEvent.deleteMany();
  await prisma.project.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-016 Regression — ProjectEvent revision uniqueness', () => {
  it('AC-A: same aggregate + same revision + same eventType — second insert rejected', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId, aggregateRevision: 1, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId, aggregateRevision: 1, eventType: 'RUN_STARTED' }); // different id, same type

    await ledger.append(eventA);
    await expect(ledger.append(eventB)).rejects.toThrow();
  });

  it('AC-B (core F-016): same aggregate + same revision + DIFFERENT eventType — second insert rejected', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId, aggregateRevision: 1, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId, aggregateRevision: 1, eventType: 'RUN_CLOSED' }); // different type!

    await ledger.append(eventA);
    await expect(ledger.append(eventB)).rejects.toThrow();
  });

  it('AC-C: same aggregate + DIFFERENT revisions — both succeed', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId, aggregateRevision: 1, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId, aggregateRevision: 2, eventType: 'RUN_CLOSED' });

    await expect(ledger.append(eventA)).resolves.toBeUndefined();
    await expect(ledger.append(eventB)).resolves.toBeUndefined();

    const stored = await ledger.getEvents(aggregateId);
    expect(stored).toHaveLength(2);
    expect(stored.map(e => e.aggregateRevision)).toEqual([1, 2]);
  });

  it('AC-D: DIFFERENT aggregates + same revision — both succeed', async () => {
    const projectId = randomUUID();
    const aggregateA = randomUUID();
    const aggregateB = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId: aggregateA, aggregateRevision: 1, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId: aggregateB, aggregateRevision: 1, eventType: 'RUN_STARTED' });

    await expect(ledger.append(eventA)).resolves.toBeUndefined();
    await expect(ledger.append(eventB)).resolves.toBeUndefined();
  });

  it('AC-E: concurrent writers on same revision — exactly one succeeds', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId, aggregateRevision: 5, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId, aggregateRevision: 5, eventType: 'RUN_CLOSED' });

    const results = await Promise.allSettled([
      ledger.append(eventA),
      ledger.append(eventB),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Exactly one event at that revision
    const stored = await ledger.getEvents(aggregateId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.aggregateRevision).toBe(5);
  });

  it('AC-F: loser transaction leaves no outbox residue', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    const eventA = makeEvent({ projectId, aggregateId, aggregateRevision: 7, eventType: 'RUN_STARTED' });
    const eventB = makeEvent({ projectId, aggregateId, aggregateRevision: 7, eventType: 'RUN_CLOSED' });

    const results = await Promise.allSettled([
      ledger.append(eventA),
      ledger.append(eventB),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes).toHaveLength(1);

    // Determine which event won
    const storedEvents = await ledger.getEvents(aggregateId);
    expect(storedEvents).toHaveLength(1);

    const storedOutbox = await prisma.outboxEvent.findMany({
      where: { aggregateId },
    });

    // Exactly one outbox entry — loser left nothing behind
    expect(storedOutbox).toHaveLength(1);
    expect(storedOutbox[0]!.id).toBe(storedEvents[0]!.id);
  });

  it('migration negative proof: duplicate (aggregateId, aggregateRevision) is rejected', async () => {
    const projectId = randomUUID();
    const aggregateId = randomUUID();
    await ensureProject(projectId);

    // Insert via Prisma directly with same revision, different eventType
    await prisma.projectEvent.create({
      data: {
        id: randomUUID(),
        projectId,
        eventType: 'RUN_STARTED',
        aggregateType: 'RUN',
        aggregateId,
        aggregateRevision: 99,
        actorType: 'ORCHESTRATOR',
        actorId: 'test',
        correlationId: randomUUID(),
        schemaVersion: 1,
        payload: {},
        occurredAt: new Date(),
      },
    });

    // Attempt to insert a second row with same revision but different eventType.
    // This must be rejected by the DB constraint (AC-B proven at the Prisma layer).
    await expect(
      prisma.projectEvent.create({
        data: {
          id: randomUUID(),
          projectId,
          eventType: 'RUN_CLOSED', // different eventType — old schema allowed this
          aggregateType: 'RUN',
          aggregateId,
          aggregateRevision: 99, // same revision — must be rejected
          actorType: 'ORCHESTRATOR',
          actorId: 'test',
          correlationId: randomUUID(),
          schemaVersion: 1,
          payload: {},
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
