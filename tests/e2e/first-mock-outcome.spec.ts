import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MockAgentAdapter } from '@co/agents';
import { CompletionEngineV0, type CompletionDecision, type CompletionStore } from '@co/completion';
import {
  TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
  WORK_PACKAGE_SCHEMA_VERSION,
  type ToolExecutionRequest,
  type WorkPackage,
} from '@co/contracts';
import {
  assertAttemptTransition,
  assertWorkItemTransition,
  createProject,
  createWorkItem,
  isActiveAttemptState,
  type Attempt,
  type AttemptState,
  type WorkItem,
  type WorkItemLifecycleState,
} from '@co/domain';
import {
  EvidenceVerificationService,
  type ArtifactRecord,
  type EvidenceRecord,
  type EvidenceStore,
  type VerificationRecord,
} from '@co/evidence';
import { ReconciliationEngineV0 } from '@co/reconciliation';
import { GovernedToolGateway, MockToolAdapter, StaticToolPolicy } from '@co/tools';
import { MinimalWorkflowEngine, type WorkflowWorkStore } from '@co/workflow';

class InMemoryWorkStore implements WorkflowWorkStore {
  readonly work = new Map<string, WorkItem>();
  readonly attempts = new Map<string, Attempt>();

  put(workItem: WorkItem): void { this.work.set(workItem.id, workItem); }
  get(workItemId: string): WorkItem { const item = this.work.get(workItemId); if (!item) throw new Error('work missing'); return item; }

  async startAttempt(input: { attempt: Attempt; expectedWorkItemRevision: number }): Promise<{ workItem: WorkItem; attempt: Attempt }> {
    const current = this.get(input.attempt.workItemId);
    if (current.revision !== input.expectedWorkItemRevision) throw new Error('revision conflict');
    if ([...this.attempts.values()].some((a) => a.workItemId === current.id && isActiveAttemptState(a.state))) throw new Error('active attempt exists');
    assertWorkItemTransition(current.lifecycleState, 'ASSIGNED');
    const attempt = { ...input.attempt };
    this.attempts.set(attempt.id, attempt);
    const workItem = { ...current, lifecycleState: 'ASSIGNED' as const, revision: current.revision + 1, currentAttemptId: attempt.id };
    this.put(workItem);
    return { workItem, attempt };
  }

  async bindAgentRun(input: { attemptId: string; agentRunId: string; agentAdapterId: string }): Promise<Attempt> { const attempt = this.attempts.get(input.attemptId); if (!attempt) throw new Error('not found'); const next = { ...attempt, agentRunId: input.agentRunId, agentAdapterId: input.agentAdapterId, updatedAt: new Date() }; this.attempts.set(next.id, next); return next; }

  async transitionAttempt(input: { attemptId: string; to: AttemptState }): Promise<Attempt> {
    const current = this.attempts.get(input.attemptId); if (!current) throw new Error('attempt missing');
    assertAttemptTransition(current.state, input.to);
    const now = new Date('2026-08-20T12:00:00Z');
    const next: Attempt = {
      ...current,
      state: input.to,
      startedAt: input.to === 'RUNNING' && current.startedAt === null ? now : current.startedAt,
      endedAt: isActiveAttemptState(input.to) ? null : now,
      updatedAt: now,
    };
    this.attempts.set(next.id, next);
    if (!isActiveAttemptState(next.state)) {
      const work = this.get(next.workItemId);
      if (work.currentAttemptId === next.id) this.put({ ...work, currentAttemptId: null });
    }
    return next;
  }

  async transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }): Promise<WorkItem> {
    const current = this.get(input.workItemId);
    if (current.revision !== input.expectedRevision) throw new Error('revision conflict');
    assertWorkItemTransition(current.lifecycleState, input.to);
    const next = { ...current, lifecycleState: input.to, revision: current.revision + 1, updatedAt: new Date('2026-08-20T12:00:00Z') };
    this.put(next);
    return next;
  }
}

class InMemoryEvidenceStore implements EvidenceStore {
  readonly artifacts: ArtifactRecord[] = [];
  readonly evidence: EvidenceRecord[] = [];
  readonly verifications: VerificationRecord[] = [];
  async saveArtifact(record: ArtifactRecord): Promise<ArtifactRecord> { this.artifacts.push(record); return record; }
  async saveEvidence(record: EvidenceRecord): Promise<EvidenceRecord> { this.evidence.push(record); return record; }
  async saveVerification(record: VerificationRecord): Promise<VerificationRecord> { this.verifications.push(record); return record; }
  async listEvidenceForWorkItem(projectId: string, workItemId: string): Promise<readonly EvidenceRecord[]> {
    return this.evidence.filter((e) => e.projectId === projectId && e.workItemId === workItemId);
  }
}

class InMemoryCompletionStore implements CompletionStore {
  readonly decisions: CompletionDecision[] = [];
  async saveDecision(decision: CompletionDecision): Promise<CompletionDecision> { this.decisions.push(decision); return decision; }
}

describe('BOOT-009 first mock end-to-end outcome', () => {
  it('executes Project -> WorkItem -> MockAgent -> Tool/Evidence -> Verification -> Reconciliation -> COMPLETE', async () => {
    const now = new Date('2026-08-20T12:00:00Z');
    const project = createProject({ id: randomUUID(), slug: 'first-e2e', name: 'First E2E', now });
    const workStore = new InMemoryWorkStore();

    const draft = createWorkItem({ id: randomUUID(), projectId: project.id, parentId: null, type: 'TASK', objective: 'Produce a verified mock change', now });
    workStore.put(draft);
    const ready = await workStore.transitionWorkItem({ workItemId: draft.id, expectedRevision: draft.revision, to: 'READY' });

    const workPackage: WorkPackage = {
      schemaVersion: WORK_PACKAGE_SCHEMA_VERSION,
      workPackageId: randomUUID(),
      version: 1,
      projectId: project.id,
      workItemId: ready.id,
      completionObjectRef: `work-item:${ready.id}`,
      objective: ready.objective,
      authoritativeInputs: [{ ref: `project:${project.id}`, classification: 'AUTHORITATIVE' }],
      scope: { refs: [`work-item:${ready.id}`] },
      constraints: [],
      authorityContextRef: 'authority://boot-009',
      requiredCapabilities: ['code_generation'],
      allowedActions: ['mock.execute'],
      forbiddenActions: [],
      toolsAllowed: ['mock'],
      expectedArtifactsOut: ['PATCH'],
      verificationRequirements: ['TEST'],
      evidenceRequirements: ['CURRENT'],
      dependencies: [],
      stopConditions: [],
    };

    const workflow = new MinimalWorkflowEngine(workStore);
    const execution = await workflow.execute({
      workItem: ready,
      workPackage,
      adapter: new MockAgentAdapter('SUCCESS'),
      correlationId: randomUUID(),
      workflowRunId: randomUUID(),
      now,
    });
    expect(execution.workItem.lifecycleState).toBe('VERIFICATION_REQUIRED');
    expect(execution.agentResult?.status).toBe('COMPLETED');

    const gateway = new GovernedToolGateway(
      new StaticToolPolicy({ allowedOperations: ['mock.execute'] }),
      [new MockToolAdapter('SUCCESS')],
    );
    const toolRequest: ToolExecutionRequest = {
      schemaVersion: TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
      requestId: randomUUID(),
      projectId: project.id,
      actorRef: execution.agentRun?.runId ?? 'mock-agent',
      workItemRef: execution.workItem.id,
      workPackageRef: workPackage.workPackageId,
      toolId: 'mock',
      operationId: 'mock.execute',
      targetResource: 'sandbox://boot-009',
      environment: 'test',
      parameters: {},
      authorityContextRef: workPackage.authorityContextRef,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    };
    const toolResult = await gateway.execute(toolRequest);
    expect(toolResult.status).toBe('SUCCEEDED');

    const evidenceStore = new InMemoryEvidenceStore();
    const evidenceService = new EvidenceVerificationService(evidenceStore, workStore);
    const agentArtifactRef = execution.agentResult?.artifacts[0];
    if (!agentArtifactRef) throw new Error('Mock agent did not produce expected artifact.');

    const artifact = await evidenceService.registerArtifact({
      projectId: project.id,
      workItemId: execution.workItem.id,
      attemptId: execution.attempt.id,
      kind: 'PATCH',
      uri: agentArtifactRef.ref,
      hash: null,
      producedBy: execution.agentRun?.runId ?? 'mock-agent',
      now,
    });
    const evidence = await evidenceService.registerEvidence({
      projectId: project.id,
      workItemId: execution.workItem.id,
      artifactId: artifact.id,
      claim: 'Governed mock tool execution succeeded for the produced artifact.',
      sourceType: 'TOOL_RESULT',
      sourceRef: `tool-execution:${toolResult.executionId}`,
      currentness: 'CURRENT',
      observedAt: now,
      now,
    });

    const resolved = await evidenceService.recordVerificationAndResolve({
      workItem: execution.workItem,
      verificationType: 'TEST',
      status: 'PASS',
      evidenceIds: [evidence.id],
      verifierRef: 'mock-verifier://boot-009',
      now,
    });
    expect(resolved.workItem.lifecycleState).toBe('COMPLETED');

    const reconciliation = new ReconciliationEngineV0().reconcile({
      project,
      workItem: resolved.workItem,
      evidence: evidenceStore.evidence,
      verifications: evidenceStore.verifications,
      now,
    });
    expect(reconciliation.state).toBe('PASS');
    expect(reconciliation.conflictCodes).toEqual([]);

    const completionStore = new InMemoryCompletionStore();
    const completion = await new CompletionEngineV0(completionStore).evaluate({
      project,
      workItem: resolved.workItem,
      completionObjectRef: workPackage.completionObjectRef,
      verifications: evidenceStore.verifications,
      evidence: evidenceStore.evidence,
      reconciliation,
      now,
    });

    expect(completion.state).toBe('COMPLETE');
    expect(completion.evaluatedProjectRevision).toBe(project.revision);
    expect(completion.evaluatedWorkItemRevision).toBe(resolved.workItem.revision);
    expect(completion.reconciliationRef).toBe(reconciliation.ref);
    expect(completionStore.decisions).toHaveLength(1);
  });
});
