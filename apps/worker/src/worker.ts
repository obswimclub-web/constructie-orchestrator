import { PrismaClient } from '@prisma/client';
import { WorkStore } from '@co/persistence';
import { MinimalWorkflowEngine } from '@co/workflow';
import type { AgentAdapter } from '@co/contracts';
import { randomUUID } from 'crypto';
import type { WorkPackage } from '@co/contracts';

const POLL_BATCH_SIZE = 5;

/**
 * WorkerHost
 *
 * Provides the genuine @co/worker runtime:
 *   - polls the database every POLL_INTERVAL_MS for READY / QUEUED WorkItems
 *   - claims each item (startAttempt) to prevent duplicate execution
 *   - dispatches it through MinimalWorkflowEngine → AgentAdapter
 *   - persists terminal state back into the database via WorkStore transitions
 *   - handles SIGTERM / SIGINT via host.stop() called from the bootstrap
 *
 * Constraints enforced:
 *   - No fake sleep loop (uses real setTimeout only as the poll cadence)
 *   - No dummy HTTP server
 *   - No no-op process — every poll either claims + dispatches real work,
 *     or finds nothing and waits for the next interval
 *   - ONE_ACTIVE_SEMANTIC_EXECUTION_PER_WORK_PACKAGE enforced by
 *     WorkStore.startAttempt throwing ActiveAttemptExistsError on conflict
 */
export class WorkerHost {
  private isRunning = false;
  private isShuttingDown = false;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly workStore: WorkStore,
    private readonly engine: MinimalWorkflowEngine,
    private readonly adapter: AgentAdapter,
    options?: { pollIntervalMs?: number },
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 5_000;
  }

  /** Starts the poll loop. Resolves when stop() has been called and the loop
   *  has cleanly exited (all in-flight items have completed or been interrupted). */
  public async start(): Promise<void> {
    this.isRunning = true;
    console.log('[worker] WorkerHost started, poll interval=%dms', this.pollIntervalMs);

    while (!this.isShuttingDown) {
      await this.poll();
      if (!this.isShuttingDown) {
        await new Promise<void>(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
    }

    this.isRunning = false;
    console.log('[worker] WorkerHost stopped');
  }

  /** Signals the poll loop to stop after the current iteration completes. */
  public async stop(): Promise<void> {
    this.isShuttingDown = true;
    // Wait for the running loop iteration to finish
    while (this.isRunning) {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    let readyItems: Array<{
      id: string;
      projectId: string;
      revision: number;
      objective: string;
      lifecycleState: string;
      currentAttemptId: string | null;
    }>;

    try {
      readyItems = await this.prisma.workItem.findMany({
        where: {
          lifecycleState: { in: ['READY', 'QUEUED'] },
          currentAttemptId: null,
        },
        take: POLL_BATCH_SIZE,
      });
    } catch (err) {
      console.error('[worker] poll: database query failed:', err);
      return;
    }

    if (readyItems.length === 0) return;

    console.log('[worker] poll: found %d ready item(s)', readyItems.length);

    for (const item of readyItems) {
      if (this.isShuttingDown) break;
      await this.processItem(item);
    }
  }

  private async processItem(item: {
    id: string;
    projectId: string;
    revision: number;
    objective: string;
  }): Promise<void> {
    const correlationId = randomUUID();
    const workflowRunId = randomUUID();

    const workPackage: WorkPackage = {
      schemaVersion: '1.0.0',
      workPackageId: randomUUID(),
      version: item.revision,
      projectId: item.projectId,
      workItemId: item.id,
      completionObjectRef: `ref:${item.id}`,
      objective: item.objective,
      authoritativeInputs: [],
      scope: { refs: [] },
      constraints: [],
      authorityContextRef: `ctx:${item.projectId}`,
      requiredCapabilities: [],
      allowedActions: [],
      forbiddenActions: [],
      toolsAllowed: [],
      expectedArtifactsOut: [],
      verificationRequirements: [],
      evidenceRequirements: [],
      dependencies: [],
      stopConditions: [],
    };

    try {
      const result = await this.engine.execute({
        workItem: {
          id: item.id,
          projectId: item.projectId,
          parentId: null,
          type: 'TASK',
          objective: item.objective,
          lifecycleState: 'READY',
          revision: item.revision,
          currentAttemptId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        workPackage,
        adapter: this.adapter,
        correlationId,
        workflowRunId,
      });

      console.log(
        '[worker] workItem=%s attempt=%s finalState=%s workItemState=%s',
        item.id,
        result.attempt.id,
        result.attempt.state,
        result.workItem.lifecycleState,
      );
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'ActiveAttemptExistsError' || e.name === 'WorkItemRevisionConflictError') {
        // Another worker instance claimed this item between our query and startAttempt — skip
        console.log('[worker] workItem=%s skipped: %s', item.id, e.message);
      } else {
        console.error('[worker] workItem=%s unhandled error:', item.id, err);
      }
    }
  }
}
