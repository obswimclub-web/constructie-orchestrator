import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkStore, AttemptStateConflictError } from '@co/persistence';
import { InvalidAttemptTransitionError } from '@co/domain';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator';

function createPrisma(): { pool: pg.Pool; prisma: PrismaClient } {
  const pool = new pg.Pool({ connectionString: databaseUrl, password: 'postgres' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { pool, prisma };
}

const { pool: poolA, prisma: prismaA } = createPrisma();
const { pool: poolB, prisma: prismaB } = createPrisma();

// Use independent WorkStore instances backed by independent connection pools.
// This ensures two concurrent $transaction calls race through separate connections.
const storeA = new WorkStore(prismaA);
const storeB = new WorkStore(prismaB);

const projectId = randomUUID();
const workItemId = randomUUID();

import { EventEmitter } from 'node:events';

class RaceCoordinator {
  private events = new EventEmitter();
  private signals = new Set<string>();

  async waitFor(event: string): Promise<void> {
    if (this.signals.has(event)) return Promise.resolve();
    return new Promise(resolve => this.events.once(event, resolve));
  }

  signal(event: string) {
    this.signals.add(event);
    this.events.emit(event);
  }
}

async function clearDatabase(): Promise<void> {
  await prismaA.incidentEventRecord.deleteMany();
  await prismaA.executionLogRecord.deleteMany();
  await prismaA.verificationRecord.deleteMany();
  await prismaA.evidenceRecord.deleteMany();
  await prismaA.artifactRecord.deleteMany();
  await prismaA.completionDecision.deleteMany();
  await prismaA.approvalAuditEvent.deleteMany();
  await prismaA.approval.deleteMany();
  await prismaA.attempt.deleteMany();
  await prismaA.workItem.deleteMany();
  await prismaA.outboxEvent.deleteMany();
  await prismaA.projectEvent.deleteMany();
  await prismaA.project.deleteMany();
}

describe('F-014 — Attempt Transition CAS Concurrency', () => {
  beforeEach(async () => {
    await clearDatabase();
    await prismaA.project.create({ data: { id: projectId, slug: `f014-test-${Date.now()}`, name: 'F-014 Test' } });
    await prismaA.workItem.create({ data: { id: workItemId, projectId, type: 'TASK', objective: 'F-014 race' } });
  });

  afterAll(async () => {
    await clearDatabase();
    await prismaA.$disconnect();
    await prismaB.$disconnect();
    await poolA.end();
    await poolB.end();
  });

  /**
   * Helper: create a RUNNING attempt for the current test.
   * Returns the attempt ID.
   */
  async function createRunningAttempt(): Promise<string> {
    const attemptId = randomUUID();
    await prismaA.attempt.create({
      data: {
        id: attemptId,
        projectId,
        workItemId,
        attemptNumber: 1,
        state: 'RUNNING',
        active: true,
        workPackageVersion: 1,
        startedAt: new Date(),
      },
    });
    await prismaA.workItem.update({
      where: { id: workItemId },
      data: { currentAttemptId: attemptId, lifecycleState: 'RUNNING' },
    });
    return attemptId;
  }

  async function createStartingAttempt(): Promise<string> {
    const attemptId = randomUUID();
    await prismaA.attempt.create({
      data: {
        id: attemptId,
        projectId,
        workItemId,
        attemptNumber: 1,
        state: 'STARTING',
        active: true,
        workPackageVersion: 1,
      },
    });
    await prismaA.workItem.update({
      where: { id: workItemId },
      data: { currentAttemptId: attemptId, lifecycleState: 'ASSIGNED' },
    });
    return attemptId;
  }

  // ── Section 12: Different-terminal race ─────────────────────────────

  it('different-terminal race: RUNNING→SUCCEEDED vs RUNNING→FAILED — exactly one winner', async () => {
    const attemptId = await createRunningAttempt();

    // Launch concurrent transitions from two independent connections.
    // Under PostgreSQL READ COMMITTED:
    // 1. Both transactions SELECT state=RUNNING and validate.
    // 2. Both issue UPDATE WHERE id=? AND state='RUNNING'.
    // 3. First writer acquires row lock and commits.
    // 4. Second writer, after acquiring lock, re-evaluates WHERE predicate
    //    against the now-committed row. state ≠ 'RUNNING' → count=0.
    // 5. Second writer throws AttemptStateConflictError.
    const results = await Promise.allSettled([
      storeA.transitionAttempt({ attemptId, to: 'SUCCEEDED' }),
      storeB.transitionAttempt({ attemptId, to: 'FAILED' }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Loser must have either:
    // - AttemptStateConflictError (CAS predicate recheck: state changed between SELECT and UPDATE)
    // - InvalidAttemptTransitionError (re-read sees committed state with no valid outgoing transition)
    // Both are correct — the distinction depends on PostgreSQL timing.
    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    const isConflict = loserReason instanceof AttemptStateConflictError;
    const isInvalidTransition = loserReason instanceof InvalidAttemptTransitionError;
    expect(isConflict || isInvalidTransition).toBe(true);

    // Winner's state is the final DB state
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ state: string }>).value;
    const dbAttempt = await prismaA.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(dbAttempt.state).toBe(winner.state);
    expect(['SUCCEEDED', 'FAILED']).toContain(dbAttempt.state);

    // Terminal state assertions
    expect(dbAttempt.active).toBe(false);
    expect(dbAttempt.endedAt).not.toBeNull();

    // WorkItem.currentAttemptId cleared by winner only
    const dbWorkItem = await prismaA.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(dbWorkItem.currentAttemptId).toBeNull();
  });

  // ── Section 13: Same-target race ────────────────────────────────────

  it('same-target race: RUNNING→SUCCEEDED vs RUNNING→SUCCEEDED — exactly one winner', async () => {
    const attemptId = await createRunningAttempt();

    const results = await Promise.allSettled([
      storeA.transitionAttempt({ attemptId, to: 'SUCCEEDED' }),
      storeB.transitionAttempt({ attemptId, to: 'SUCCEEDED' }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly-once: even same target, only one transition may commit.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    const isConflict = loserReason instanceof AttemptStateConflictError;
    const isInvalidTransition = loserReason instanceof InvalidAttemptTransitionError;
    expect(isConflict || isInvalidTransition).toBe(true);

    const dbAttempt = await prismaA.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(dbAttempt.state).toBe('SUCCEEDED');
    expect(dbAttempt.active).toBe(false);
    expect(dbAttempt.endedAt).not.toBeNull();
  });

  // ── Section 14: Active-state race ───────────────────────────────────

  it('active-vs-terminal race: STARTING→RUNNING vs STARTING→FAILED — exactly one winner', async () => {
    const attemptId = await createStartingAttempt();

    const results = await Promise.allSettled([
      storeA.transitionAttempt({ attemptId, to: 'RUNNING' }),
      storeB.transitionAttempt({ attemptId, to: 'FAILED' }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    const isConflict = loserReason instanceof AttemptStateConflictError;
    const isInvalidTransition = loserReason instanceof InvalidAttemptTransitionError;
    expect(isConflict || isInvalidTransition).toBe(true);

    const dbAttempt = await prismaA.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ state: string }>).value;
    expect(dbAttempt.state).toBe(winner.state);

    if (dbAttempt.state === 'RUNNING') {
      expect(dbAttempt.active).toBe(true);
      expect(dbAttempt.startedAt).not.toBeNull();
      expect(dbAttempt.endedAt).toBeNull();
    } else {
      expect(dbAttempt.state).toBe('FAILED');
      expect(dbAttempt.active).toBe(false);
      expect(dbAttempt.endedAt).not.toBeNull();
    }
  });

  // ── Section 15: Invalid transition preserved ────────────────────────

  it('invalid transition still rejected: SUCCEEDED → RUNNING throws InvalidAttemptTransitionError', async () => {
    const attemptId = randomUUID();
    await prismaA.attempt.create({
      data: {
        id: attemptId, projectId, workItemId,
        attemptNumber: 2, state: 'SUCCEEDED', active: false,
        workPackageVersion: 1, endedAt: new Date(),
      },
    });

    await expect(
      storeA.transitionAttempt({ attemptId, to: 'RUNNING' }),
    ).rejects.toThrow(InvalidAttemptTransitionError);
  });

  // ── Section 17: Pre-fix behavior verification ───────────────────────
  // The old implementation used: UPDATE WHERE id = attemptId (no state predicate).
  // Under that implementation, both concurrent UPDATEs would match the row
  // (PostgreSQL row-level lock serializes them, but both see id match after
  // lock release and both succeed with count=1).
  // With the CAS fix: UPDATE WHERE id = attemptId AND state = 'RUNNING'
  // After the first writer commits (changing state to SUCCEEDED), the second
  // writer re-evaluates WHERE and state ≠ 'RUNNING' → count=0 → conflict error.

  it('sequential proof: second transition from stale state is rejected', async () => {
    const attemptId = await createRunningAttempt();

    const result1 = await storeA.transitionAttempt({ attemptId, to: 'SUCCEEDED' });
    expect(result1.state).toBe('SUCCEEDED');

    await expect(
      storeA.transitionAttempt({ attemptId, to: 'FAILED' }),
    ).rejects.toThrow(InvalidAttemptTransitionError);

    const dbAttempt = await prismaA.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(dbAttempt.state).toBe('SUCCEEDED');
  });

  // ── Section 16/17: Deterministic Race Proof ─────────────────────────

  it('deterministic race proof: guarantees both operations validate same original state before either UPDATE completes', async () => {
    const attemptId = await createRunningAttempt();
    const coordinator = new RaceCoordinator();

    // We create extended Prisma clients that intercept the updateMany query.
    // This allows us to pause BOTH transactions precisely after they have
    // read and validated the original 'RUNNING' state, but before either
    // applies its UPDATE.
    const prismaExtA = prismaA.$extends({
      query: {
        attempt: {
          async updateMany({ args, query }) {
            coordinator.signal('A_READY_TO_UPDATE');
            await coordinator.waitFor('PROCEED_UPDATES');
            return query(args);
          },
          // In the old implementation it used 'update' instead of 'updateMany'
          async update({ args, query }) {
            coordinator.signal('A_READY_TO_UPDATE');
            await coordinator.waitFor('PROCEED_UPDATES');
            return query(args);
          }
        }
      }
    });

    const prismaExtB = prismaB.$extends({
      query: {
        attempt: {
          async updateMany({ args, query }) {
            coordinator.signal('B_READY_TO_UPDATE');
            await coordinator.waitFor('PROCEED_UPDATES');
            return query(args);
          },
          async update({ args, query }) {
            coordinator.signal('B_READY_TO_UPDATE');
            await coordinator.waitFor('PROCEED_UPDATES');
            return query(args);
          }
        }
      }
    });

    // Create stores bound to the hooked clients
    const hookedStoreA = new WorkStore(prismaExtA as unknown as PrismaClient);
    const hookedStoreB = new WorkStore(prismaExtB as unknown as PrismaClient);

    // Launch concurrent transitions
    const pA = hookedStoreA.transitionAttempt({ attemptId, to: 'SUCCEEDED' });
    const pB = hookedStoreB.transitionAttempt({ attemptId, to: 'FAILED' });

    // Wait until BOTH transactions have executed their SELECT, validated
    // the state, and are blocked immediately prior to UPDATE
    await coordinator.waitFor('A_READY_TO_UPDATE');
    await coordinator.waitFor('B_READY_TO_UPDATE');

    // Both are now firmly in the TOCTOU gap.
    // Release them to race the UPDATE statements.
    coordinator.signal('PROCEED_UPDATES');

    const results = await Promise.allSettled([pA, pB]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Expected exactly one winner
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Because both deterministically validated the SAME original state,
    // the loser MUST reach the CAS predicate and fail with AttemptStateConflictError.
    // InvalidAttemptTransitionError is not a valid outcome here because we
    // guarantee the SELECT happened before the winner's UPDATE.
    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserReason).toBeInstanceOf(AttemptStateConflictError);
  });
});
