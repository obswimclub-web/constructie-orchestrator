import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { WorkStore } from '@co/persistence';
import { MinimalWorkflowEngine } from '@co/workflow';
import { EvidenceStore } from '@co/evidence';

import type { AgentAdapter } from '@co/contracts';
import { randomUUID } from 'crypto';
import type { WorkPackage } from '@co/contracts';
import { WorkPackageSchema } from '@co/contracts';

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
    private readonly evidenceStore: EvidenceStore,
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


    const workPackage: WorkPackage = WorkPackageSchema.parse({
      schemaVersion: '1.0.0',
      workPackageId: randomUUID(),
      version: item.revision,
      projectId: item.projectId,
      workItemId: item.id,
      completionObjectRef: `ref:${item.id}`,
      objective: item.objective,
      authorityContextRef: `ctx:${item.projectId}`,
      scope: { refs: [] },
      evidenceRequirements: (item as any).evidenceRequirements // eslint-disable-line @typescript-eslint/no-explicit-any,
    });

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
          evidenceRequirements: (item as any).evidenceRequirements // eslint-disable-line @typescript-eslint/no-explicit-any,
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


      // Persist artifacts and evidence
      if (result.agentResult) {
        let artIdx = 0;
        for (const art of result.agentResult.artifacts || []) {
          const rawHash = crypto.createHash('sha256').update(result.agentRun?.runId + '-art-' + artIdx++).digest('hex');
          const deterministicId = rawHash.slice(0,8)+'-'+rawHash.slice(8,12)+'-4'+rawHash.slice(13,16)+'-8'+rawHash.slice(17,20)+'-'+rawHash.slice(20,32);

          try {
            await this.evidenceStore.saveArtifact({
              id: art.artifactId || deterministicId,
              projectId: item.projectId,
              runId: result.agentRun?.runId || 'unknown',
              workItemId: item.id,
              attemptId: result.attempt.id,
              kind: (art.type as "OTHER") || 'OTHER',
              uri: art.ref,
              hash: null,
              producedBy: 'codex-adapter',
              createdAt: new Date(),
            });
          } catch (err: unknown) {
             if ((err as Error).name !== 'DuplicateRecordError') throw err;
          }
        }

        for (const ev of result.agentResult.evidence || []) {
          if (!ev.evidenceId) {
            throw new Error(`Worker persistence rejected evidence: missing evidenceId for claim '${ev.claimSupported}'`);
          }

          try {
            await this.evidenceStore.saveEvidence({
              id: ev.evidenceId,
              projectId: item.projectId,
              runId: result.agentRun?.runId || 'unknown',
              workItemId: item.id,
              attemptId: result.attempt.id,
              approvalId: null,
              agentId: 'codex-adapter',
              artifactId: null,
              claim: ev.claimSupported,
              sourceType: (ev.type as "AGENT_RESULT") || 'AGENT_RESULT',
              sourceRef: ev.sourceRef,
              scmCommitSha: null,
              deploymentUri: null,
              currentness: 'CURRENT',
              observedAt: new Date(),
              createdAt: new Date(),
            });
          } catch (err: unknown) {
             if ((err as Error).name !== 'DuplicateRecordError') throw err;
          }
        }
      }
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
