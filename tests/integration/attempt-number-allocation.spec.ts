/**
 * F-011 Regression: Durable monotonic attempt number allocation.
 *
 * Requires a real PostgreSQL connection (uses DATABASE_URL env or default).
 * Tests that attempt numbers are allocated durably by persistence,
 * never hardcoded, monotonically increasing, per-WorkItem, gap-tolerant,
 * restart-safe, and concurrency-safe.
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkStore } from '../../packages/persistence/src/work/work-store.js';
import { createWorkItem, createProject } from '@co/domain';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/orchestrator',
  password: 'postgres',
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const workStore = new WorkStore(prisma);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const projectId = randomUUID();

async function ensureProject(): Promise<void> {
  const project = createProject({
    id: projectId,
    slug: `proj-${projectId.slice(0, 8)}`,
    name: `F-011 Test Project`,
    now: new Date(),
  });
  await prisma.project.upsert({
    where: { id: projectId },
    create: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      lifecycleState: project.lifecycleState,
      revision: project.revision,
    },
    update: {},
  });
}

async function createReadyWorkItem(): Promise<{
  id: string;
  revision: number;
}> {
  const wi = createWorkItem({
    id: randomUUID(),
    projectId,
    parentId: null,
    type: 'TASK',
    objective: 'F-011 test',
    now: new Date(),
  });
  await workStore.createWorkItem(wi);
  const ready = await workStore.transitionWorkItem({
    workItemId: wi.id,
    expectedRevision: wi.revision,
    to: 'READY',
  });
  return { id: ready.id, revision: ready.revision };
}

function makeNewAttempt(workItemId: string) {
  return {
    id: randomUUID(),
    projectId,
    workItemId,
    state: 'NOT_STARTED' as const,
    workPackageVersion: 1,
    agentRunId: null,
    agentAdapterId: null,
    startedAt: null,
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await prisma.attempt.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.project.deleteMany();
  await ensureProject();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-011 Regression — Durable attempt number allocation', () => {
  it('T1: first attempt receives attemptNumber = 1', async () => {
    const wi = await createReadyWorkItem();
    const result = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    expect(result.attempt.attemptNumber).toBe(1);
  });

  it('T2: retry after terminal FAILED receives attemptNumber = 2', async () => {
    const wi = await createReadyWorkItem();
    // Start attempt #1
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    expect(first.attempt.attemptNumber).toBe(1);

    // Transition to RUNNING then FAILED
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id,
      expectedRevision: first.workItem.revision,
      to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id,
      expectedRevision: workItem.revision,
      to: 'REPAIR_REQUIRED',
    });

    // Return to READY for retry
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id,
      expectedRevision: workItem.revision,
      to: 'READY',
    });

    // Start attempt #2
    const second = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: workItem.revision,
    });
    expect(second.attempt.attemptNumber).toBe(2);
  });

  it('T3: third legitimate attempt receives attemptNumber = 3', async () => {
    const wi = await createReadyWorkItem();

    // Attempt #1
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: first.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });

    // Attempt #2
    const second = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: workItem.revision,
    });
    await workStore.transitionAttempt({ attemptId: second.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: second.attempt.id, to: 'RUNNING' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: second.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: second.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });

    // Attempt #3
    const third = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: workItem.revision,
    });
    expect(third.attempt.attemptNumber).toBe(3);
  });

  it('T4: restart / runtime reconstruction preserves next number', async () => {
    const wi = await createReadyWorkItem();

    // Start and terminate attempt #1 with original WorkStore
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: first.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });
    await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });

    // Simulate restart: create a NEW WorkStore instance (fresh runtime object)
    const pool2 = new pg.Pool({
      connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator',
      password: 'postgres',
    });
    const adapter2 = new PrismaPg(pool2);
    const prisma2 = new PrismaClient({ adapter: adapter2 });
    const freshStore = new WorkStore(prisma2);

    try {
      const freshWorkItem = await freshStore.getWorkItem(wi.id);
      const second = await freshStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: freshWorkItem.revision,
      });
      expect(second.attempt.attemptNumber).toBe(2);
    } finally {
      await prisma2.$disconnect();
      await pool2.end();
    }
  });

  it('T5: different WorkItems start independently at 1', async () => {
    const wiA = await createReadyWorkItem();
    const wiB = await createReadyWorkItem();

    // Start attempt for WorkItem A
    const resultA = await workStore.startAttempt({
      attempt: makeNewAttempt(wiA.id),
      expectedWorkItemRevision: wiA.revision,
    });
    // Terminate it so we can start another for A
    await workStore.transitionAttempt({ attemptId: resultA.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: resultA.attempt.id, to: 'RUNNING' });
    let wiAState = await workStore.transitionWorkItem({
      workItemId: wiA.id, expectedRevision: resultA.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: resultA.attempt.id, to: 'FAILED' });
    wiAState = await workStore.transitionWorkItem({
      workItemId: wiA.id, expectedRevision: wiAState.revision, to: 'REPAIR_REQUIRED',
    });
    wiAState = await workStore.transitionWorkItem({
      workItemId: wiA.id, expectedRevision: wiAState.revision, to: 'READY',
    });

    // Start attempt #2 for A
    const resultA2 = await workStore.startAttempt({
      attempt: makeNewAttempt(wiA.id),
      expectedWorkItemRevision: wiAState.revision,
    });

    // Start attempt for WorkItem B (should be #1, independent of A)
    const resultB = await workStore.startAttempt({
      attempt: makeNewAttempt(wiB.id),
      expectedWorkItemRevision: wiB.revision,
    });

    expect(resultA.attempt.attemptNumber).toBe(1);
    expect(resultA2.attempt.attemptNumber).toBe(2);
    expect(resultB.attempt.attemptNumber).toBe(1);
  });

  it('T6: historical gap uses MAX+1, does not reuse gap number', async () => {
    const wi = await createReadyWorkItem();

    // Create attempt #1 via startAttempt
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    expect(first.attempt.attemptNumber).toBe(1);

    // Artificially inject a gap: delete attempt #1 and manually create attempt #3
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: first.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });

    // Manually insert attempt #3 via raw Prisma to create a gap (1, 3)
    await prisma.attempt.create({
      data: {
        id: randomUUID(),
        projectId,
        workItemId: wi.id,
        attemptNumber: 3,
        state: 'FAILED',
        active: false,
        workPackageVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });

    // Next attempt should be 4 (MAX=3 + 1), not 2 (gap reuse)
    const next = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: workItem.revision,
    });
    expect(next.attempt.attemptNumber).toBe(4);
  });

  it('T7: concurrent initial claims → exactly one success', async () => {
    const wi = await createReadyWorkItem();

    const results = await Promise.allSettled([
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Winner got attemptNumber 1
    const winner = (successes[0] as PromiseFulfilledResult<{ attempt: { attemptNumber: number } }>).value;
    expect(winner.attempt.attemptNumber).toBe(1);

    // Exactly one attempt in DB
    const attempts = await prisma.attempt.findMany({ where: { workItemId: wi.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.attemptNumber).toBe(1);
  });

  it('T8: concurrent retry claims after attempt #1 → exactly one success with #2', async () => {
    const wi = await createReadyWorkItem();

    // Create and terminate attempt #1
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: first.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: first.attempt.id, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });

    // Two concurrent retry attempts
    const results = await Promise.allSettled([
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: workItem.revision,
      }),
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: workItem.revision,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Winner got attemptNumber 2
    const winner = (successes[0] as PromiseFulfilledResult<{ attempt: { attemptNumber: number } }>).value;
    expect(winner.attempt.attemptNumber).toBe(2);

    // DB contains exactly attempts #1 and #2
    const attempts = await prisma.attempt.findMany({
      where: { workItemId: wi.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.attemptNumber).toBe(1);
    expect(attempts[1]!.attemptNumber).toBe(2);
  });

  it('T9: losing concurrent caller leaves no Attempt row', async () => {
    const wi = await createReadyWorkItem();

    const results = await Promise.allSettled([
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes).toHaveLength(1);

    // Only one attempt row in DB — loser left nothing
    const attempts = await prisma.attempt.findMany({ where: { workItemId: wi.id } });
    expect(attempts).toHaveLength(1);
  });

  it('T10: failed transactional create leaves WorkItem claim rolled back', async () => {
    const wi = await createReadyWorkItem();

    // Start and lose a concurrent race — the loser's WorkItem claim should be rolled back
    const results = await Promise.allSettled([
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
      workStore.startAttempt({
        attempt: makeNewAttempt(wi.id),
        expectedWorkItemRevision: wi.revision,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    expect(successes).toHaveLength(1);

    // WorkItem should point to the winner's attempt, not a nonexistent one
    const workItem = await workStore.getWorkItem(wi.id);
    const winnerAttempt = (successes[0] as PromiseFulfilledResult<{ attempt: { id: string } }>).value.attempt;
    expect(workItem.currentAttemptId).toBe(winnerAttempt.id);
  });

  it('T11: existing unique DB constraint rejects direct duplicate number', async () => {
    const wi = await createReadyWorkItem();

    // Start attempt #1 normally
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    expect(first.attempt.attemptNumber).toBe(1);

    // Try to insert a raw duplicate attempt_number = 1 for the same work_item via raw Prisma
    await expect(
      prisma.attempt.create({
        data: {
          id: randomUUID(),
          projectId,
          workItemId: wi.id,
          attemptNumber: 1,
          state: 'NOT_STARTED',
          active: true,
          workPackageVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('T12: previous historical Attempt remains unchanged after retry', async () => {
    const wi = await createReadyWorkItem();

    // Start attempt #1
    const first = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: wi.revision,
    });
    const firstId = first.attempt.id;
    const firstNumber = first.attempt.attemptNumber;

    // Transition to terminal
    await workStore.transitionAttempt({ attemptId: firstId, to: 'STARTING' });
    await workStore.transitionAttempt({ attemptId: firstId, to: 'RUNNING' });
    let workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: first.workItem.revision, to: 'RUNNING',
    });
    await workStore.transitionAttempt({ attemptId: firstId, to: 'FAILED' });
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'REPAIR_REQUIRED',
    });

    // Capture attempt #1 state after termination
    const attempt1Before = await workStore.getAttempt(firstId);

    // Return to READY and start retry
    workItem = await workStore.transitionWorkItem({
      workItemId: wi.id, expectedRevision: workItem.revision, to: 'READY',
    });
    const second = await workStore.startAttempt({
      attempt: makeNewAttempt(wi.id),
      expectedWorkItemRevision: workItem.revision,
    });
    expect(second.attempt.attemptNumber).toBe(2);

    // Verify attempt #1 is unchanged
    const attempt1After = await workStore.getAttempt(firstId);
    expect(attempt1After.id).toBe(attempt1Before.id);
    expect(attempt1After.attemptNumber).toBe(firstNumber);
    expect(attempt1After.attemptNumber).toBe(1);
    expect(attempt1After.state).toBe(attempt1Before.state);
    expect(attempt1After.state).toBe('FAILED');
  });
});
