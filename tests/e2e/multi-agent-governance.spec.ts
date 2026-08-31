import { describe, expect, it } from 'vitest';
import { RunCoordinator } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { PrismaEventLedger } from '../../packages/persistence/src/project/prisma-event-ledger.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';

describe('Multi-Agent / Provider Execution Governance E2E', () => {
  it('orchestrator routes distinct executor/reviewer agents inside the same workflow and audits them distinctly', async () => {
    const taskId = 'task-v1-02-multi';
    const projectId = 'proj-v1-02-multi';

    const mockEvents: unknown[] = [];
    const ledgerClient = {
      $transaction: async (fn: (c: typeof ledgerClient) => Promise<void>) => fn(ledgerClient),
      projectEvent: {
        create: async (e: { data: { aggregateId: string; aggregateRevision: number } }) => { mockEvents.push(e.data); return e.data; },
        findMany: async (args: { where: { aggregateId: string } }) =>
          mockEvents.filter((e: { aggregateId: string }) => e.aggregateId === args.where.aggregateId).sort((a: { aggregateRevision: number }, b: { aggregateRevision: number }) => a.aggregateRevision - b.aggregateRevision)
      },
      outboxEvent: { create: async () => {} }
    };
    const eventLedger = new PrismaEventLedger(ledgerClient as unknown as import('@prisma/client').PrismaClient);

    const executorBridge: AgentBridge = {
      dispatch: async () => { return { runId: 'run-exec-1', status: 'RUNNING' }; },
      getStatus: async () => { return 'COMPLETED'; },
      getResult: async (ref) => { return {
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Executor done', actionsTaken: [], artifacts: [], findings: [], evidence: [{ id: 'ev1', kind: 'stuff', content: 'stuff' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }; },
      cancel: async () => { }
    };

    const reviewerBridge: AgentBridge = {
      dispatch: async () => { return { runId: 'run-rev-1', status: 'RUNNING' }; },
      getStatus: async () => { return 'COMPLETED'; },
      getResult: async (ref) => { return {
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Reviewer done', actionsTaken: [], artifacts: [], findings: [], evidence: [{ id: 'ev2', kind: 'stuff', content: 'stuff' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }; },
      cancel: async () => { }
    };

    const router = new MultiAgentRouter({
      selectBridge: (wp) => {
        if (wp.requiredCapabilities.includes('review')) return reviewerBridge;
        return executorBridge;
      }
    });

    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, taskId, { timeoutMs: 100, intervalMs: 10 });

    const execWp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-exec', version: 1, projectId, workItemId: taskId,
      completionObjectRef: 'ref', objective: 'Execute task', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: ['code_generation'], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: [],
    };
    await coordinator.execute(execWp, 'workflow-run-multi', 'corr-exec', projectId);

    const revWp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-rev', version: 1, projectId, workItemId: taskId,
      completionObjectRef: 'ref', objective: 'Review task', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
      requiredCapabilities: ['review'], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: [],
    };
    await coordinator.execute(revWp, 'workflow-run-multi', 'corr-rev', projectId);

    const events = await eventLedger.getEvents('workflow-run-multi');
    const dispatchEvents = events.filter(e => e.eventType === 'RUN_DISPATCHED');
    expect(dispatchEvents).toHaveLength(2);

    expect((dispatchEvents[0]!.payload as { runId: string }).runId).toBe('run-exec-1');
    expect((dispatchEvents[1]!.payload as { runId: string }).runId).toBe('run-rev-1');
  });
});
