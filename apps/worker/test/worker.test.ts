import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerHost } from '../src/worker.js';

// ---------------------------------------------------------------------------
// Minimal fakes — shaped to satisfy WorkerHost constructor types without
// importing real adapters (avoids side-effects, external deps, or network I/O)
// ---------------------------------------------------------------------------

function makePrisma(items: unknown[] = []) {
  return {
    workItem: {
      findMany: vi.fn().mockResolvedValue(items),
    },
  };
}

function makeWorkStore() {
  return {
    startAttempt: vi.fn(),
    transitionAttempt: vi.fn(),
    bindAgentRun: vi.fn(),
    transitionWorkItem: vi.fn(),
  };
}

function makeEngine(workStore: ReturnType<typeof makeWorkStore>) {
  return {
    execute: vi.fn().mockResolvedValue({
      workItem: {
        id: 'item-1', projectId: 'proj-1', objective: 'Test',
        lifecycleState: 'VERIFICATION_REQUIRED', revision: 3,
        currentAttemptId: 'attempt-1', parentId: null, type: 'TASK',
        createdAt: new Date(), updatedAt: new Date(),
      },
      attempt: { id: 'attempt-1', state: 'SUCCEEDED', workPackageVersion: 1 },
      agentRun: { runId: 'run-1', status: 'COMPLETED' },
      agentResult: null,
    }),
    _store: workStore,
  };
}

function makeAdapter() {
  return {
    capabilities: vi.fn().mockResolvedValue({ capabilities: {} }),
    execute: vi.fn().mockResolvedValue({ runId: 'run-1', status: 'COMPLETED' }),
    resume: vi.fn(),
    getStatus: vi.fn().mockResolvedValue('COMPLETED'),
    getArtifacts: vi.fn().mockResolvedValue([]),
    getEvidence: vi.fn().mockResolvedValue([]),
    getUsage: vi.fn().mockResolvedValue({ inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }),
    cancel: vi.fn().mockResolvedValue({ runRef: { runId: 'run-1' }, status: 'CANCELLED' }),
  };
}

/** Short poll interval so tests complete well within vitest's 5000ms default. */
const TEST_POLL_MS = 50;

// ---------------------------------------------------------------------------

describe('WorkerHost', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let workStore: ReturnType<typeof makeWorkStore>;
  let engine: ReturnType<typeof makeEngine>;
  let adapter: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    prisma = makePrisma();
    workStore = makeWorkStore();
    engine = makeEngine(workStore);
    adapter = makeAdapter();
  });

  it('starts and stops cleanly when there are no ready items', async () => {
    const host = new WorkerHost(
      prisma as never,
      workStore as never,
      engine as never,
      adapter as never,
      { pollIntervalMs: TEST_POLL_MS },
    );

    const startPromise = host.start();
    await new Promise(r => setTimeout(r, 200));
    await host.stop();
    await startPromise;

    expect(prisma.workItem.findMany).toHaveBeenCalled();
    expect(engine.execute).not.toHaveBeenCalled();
  }, 10_000);

  it('dispatches ready work items through the engine', async () => {
    const items = [{
      id: 'item-1', projectId: 'proj-1', revision: 1,
      objective: 'Test obj', lifecycleState: 'READY', currentAttemptId: null,
    }];
    prisma = makePrisma(items);
    prisma.workItem.findMany
      .mockResolvedValueOnce(items)
      .mockResolvedValue([]);

    engine = makeEngine(workStore);

    const host = new WorkerHost(
      prisma as never,
      workStore as never,
      engine as never,
      adapter as never,
      { pollIntervalMs: TEST_POLL_MS },
    );

    const startPromise = host.start();
    await new Promise(r => setTimeout(r, 300));
    await host.stop();
    await startPromise;

    expect(engine.execute).toHaveBeenCalledTimes(1);
    const call = engine.execute.mock.calls[0]![0] as Record<string, unknown>;
    expect((call.workItem as Record<string, unknown>).id).toBe('item-1');
    expect((call.workPackage as Record<string, unknown>).workItemId).toBe('item-1');
  }, 10_000);

  it('skips items that throw ActiveAttemptExistsError without propagating', async () => {
    const items = [{
      id: 'item-2', projectId: 'proj-1', revision: 1,
      objective: 'Conflict', lifecycleState: 'READY', currentAttemptId: null,
    }];
    prisma = makePrisma(items);
    prisma.workItem.findMany.mockResolvedValueOnce(items).mockResolvedValue([]);

    engine = makeEngine(workStore);
    const conflict = new Error('ActiveAttemptExistsError: already claimed');
    conflict.name = 'ActiveAttemptExistsError';
    engine.execute.mockRejectedValueOnce(conflict);

    const host = new WorkerHost(
      prisma as never,
      workStore as never,
      engine as never,
      adapter as never,
      { pollIntervalMs: TEST_POLL_MS },
    );

    const startPromise = host.start();
    await new Promise(r => setTimeout(r, 300));
    await host.stop();
    await startPromise;

    // No crash, engine was called exactly once
    expect(engine.execute).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('skips items that throw WorkItemRevisionConflictError without propagating', async () => {
    const items = [{
      id: 'item-3', projectId: 'proj-1', revision: 1,
      objective: 'Stale', lifecycleState: 'READY', currentAttemptId: null,
    }];
    prisma = makePrisma(items);
    prisma.workItem.findMany.mockResolvedValueOnce(items).mockResolvedValue([]);

    engine = makeEngine(workStore);
    const conflict = new Error('WorkItemRevisionConflictError: revision mismatch');
    conflict.name = 'WorkItemRevisionConflictError';
    engine.execute.mockRejectedValueOnce(conflict);

    const host = new WorkerHost(
      prisma as never,
      workStore as never,
      engine as never,
      adapter as never,
      { pollIntervalMs: TEST_POLL_MS },
    );

    const startPromise = host.start();
    await new Promise(r => setTimeout(r, 300));
    await host.stop();
    await startPromise;

    expect(engine.execute).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('continues polling after a transient engine error', async () => {
    const item = {
      id: 'item-4', projectId: 'proj-1', revision: 1,
      objective: 'Transient', lifecycleState: 'READY', currentAttemptId: null,
    };
    prisma = makePrisma([item]);
    prisma.workItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValue([]);

    engine = makeEngine(workStore);
    engine.execute.mockRejectedValueOnce(new Error('Unexpected runtime error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const host = new WorkerHost(
      prisma as never,
      workStore as never,
      engine as never,
      adapter as never,
      { pollIntervalMs: TEST_POLL_MS },
    );

    const startPromise = host.start();
    await new Promise(r => setTimeout(r, 300));
    await host.stop();
    await startPromise;

    // Should have logged error but not crashed
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('unhandled error:'),
      'item-4',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  }, 10_000);
});
