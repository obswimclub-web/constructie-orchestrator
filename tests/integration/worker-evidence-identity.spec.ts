/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaEvidenceStore } from '@co/persistence';
import { WorkerHost } from '../../apps/worker/src/worker';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Worker Evidence Identity Contract (P12-R65W)', () => {
  let projectId: string;
  let evidenceStore: PrismaEvidenceStore;

  beforeAll(async () => {
    projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        name: 'Identity Test Project',
        slug: 'ident-test-' + randomUUID().slice(0, 8)
      },
    });
    evidenceStore = new PrismaEvidenceStore(prisma);
  });

  it('preserves adapter evidenceId exactly, same replay = same persisted ID, distinct instances = distinct IDs', async () => {
    const wiId = randomUUID();
    await prisma.workItem.create({
      data: { id: wiId, projectId, type: 'TASK', objective: 'Test Ident', lifecycleState: 'READY', revision: 1 }
    });
    const attemptId = randomUUID();
    await prisma.attempt.create({
      data: { id: attemptId, workItemId: wiId, workPackageVersion: 1, state: 'RUNNING', attemptNumber: 1, projectId }
    });

    const runId = randomUUID();
    const ev1Id = randomUUID();
    const ev2Id = randomUUID();

    expect(ev1Id).not.toBe(ev2Id);

    const result = {
      agentRun: { runId, status: 'COMPLETED' },
      attempt: { id: attemptId, state: 'SUCCEEDED' },
      workItem: { lifecycleState: 'VERIFICATION_REQUIRED' }, agentResult: {
        schemaVersion: '1.0.0',
        runRef: { runId },
        status: 'COMPLETED',
        summary: 'Done',
        evidence: [
          { type: 'test', claimSupported: 'claim 1', sourceRef: 'src 1', evidenceId: ev1Id },
          { type: 'test', claimSupported: 'claim 2', sourceRef: 'src 2', evidenceId: ev2Id },
        ]
      }
    };

    const host = new WorkerHost(prisma as any, { getWorkItem: async () => ({ id: wiId, projectId, revision: 1, version: 1, objective: 'Test', lifecycleState: 'READY' }), transitionWorkItem: async () => {}, transitionAttempt: async () => {} } as any, { execute: async () => result } as any, {} as any, evidenceStore, { pollIntervalMs: 50 });

    await host['processItem']({ id: wiId, projectId, revision: 1, version: 1, objective: 'Test', lifecycleState: 'READY' } as any);

    const stored1 = await prisma.evidenceRecord.findUnique({ where: { id: ev1Id } });
    const stored2 = await prisma.evidenceRecord.findUnique({ where: { id: ev2Id } });

    expect(stored1).not.toBeNull();
    expect(stored1!.id).toBe(ev1Id);
    expect(stored2).not.toBeNull();
    expect(stored2!.id).toBe(ev2Id);

    await host['processItem']({ id: wiId, projectId, revision: 1, version: 1, objective: 'Test', lifecycleState: 'READY' } as any);

    const allEvidence = await prisma.evidenceRecord.findMany({ where: { attemptId } });
    expect(allEvidence).toHaveLength(2);
    expect(allEvidence.map(e => e.id).sort()).toEqual([ev1Id, ev2Id].sort());
  });

  it('Worker never replaces adapter evidenceId and explicitly fails if missing evidenceId', async () => {
    const wiId = randomUUID();
    await prisma.workItem.create({
      data: { id: wiId, projectId, type: 'TASK', objective: 'Test Fail', lifecycleState: 'READY', revision: 1 }
    });
    const attemptId = randomUUID();
    await prisma.attempt.create({
      data: { id: attemptId, workItemId: wiId, workPackageVersion: 1, state: 'RUNNING', attemptNumber: 1, projectId }
    });

    const result = {
      agentRun: { runId: randomUUID(), status: 'COMPLETED' },
      attempt: { id: attemptId, state: 'SUCCEEDED' },
      workItem: { lifecycleState: 'VERIFICATION_REQUIRED' }, agentResult: {
        schemaVersion: '1.0.0',
        runRef: { runId: 'foo' },
        status: 'COMPLETED',
        summary: 'Done',
        evidence: [
          { type: 'test', claimSupported: 'claim 3 missing id', sourceRef: 'src 3' },
        ]
      }
    };

    const host = new WorkerHost(prisma as any, { getWorkItem: async () => ({ id: wiId, projectId, revision: 1, version: 1, objective: 'Test', lifecycleState: 'READY' }), transitionWorkItem: async () => {}, transitionAttempt: async () => {} } as any, { execute: async () => result } as any, {} as any, evidenceStore, { pollIntervalMs: 50 });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await host['processItem']({ id: wiId, projectId, revision: 1, version: 1, objective: 'Test', lifecycleState: 'READY' } as any);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('unhandled error:'),
      wiId,
      expect.objectContaining({ message: expect.stringContaining("Worker persistence rejected evidence: missing evidenceId for claim 'claim 3 missing id'") })
    );

    consoleSpy.mockRestore();

    const allEvidence = await prisma.evidenceRecord.findMany({ where: { attemptId } });
    expect(allEvidence).toHaveLength(0);
  });
});
