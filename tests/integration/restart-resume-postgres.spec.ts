import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockAgentAdapter, MockAgentRunRegistry } from '@co/agents';
import { WORK_PACKAGE_SCHEMA_VERSION, type WorkPackage } from '@co/contracts';
import { createProject, createWorkItem, type Attempt } from '@co/domain';
import { ProjectStore, WorkStore } from '@co/persistence';
import { WorkflowResumeCoordinator } from '@co/workflow';

const prismaA = new PrismaClient();

async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.completionDecision.deleteMany();
  await prisma.verificationRecord.deleteMany();
  await prisma.evidenceRecord.deleteMany();
  await prisma.artifactRecord.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.projectEvent.deleteMany();
  await prisma.project.deleteMany();
}

describe('BOOT Qualification — PostgreSQL restart/resume proof', () => {
  beforeEach(async () => {
    await clearDatabase(prismaA);
  });

  afterAll(async () => {
    await prismaA.$disconnect();
  });

  it('recreates Prisma/WorkStore, resumes the same provider run, and preserves a single semantic attempt', async () => {
    const now = new Date('2026-08-20T13:00:00Z');
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const attemptId = randomUUID();
    const correlationId = randomUUID();

    const projectStoreA = new ProjectStore(prismaA);
    const workStoreA = new WorkStore(prismaA);
    const project = createProject({ id: projectId, slug: `restart-${projectId.slice(0, 8)}`, name: 'Restart Qualification', now });

    await projectStoreA.create({
      project,
      event: {
        id: randomUUID(),
        projectId,
        eventType: 'PROJECT_CREATED',
        aggregateType: 'PROJECT',
        aggregateId: projectId,
        aggregateRevision: 1,
        actorType: 'ORCHESTRATOR',
        actorId: 'qualification-gate',
        correlationId,
        causationId: null,
        schemaVersion: 1,
        payload: { slug: project.slug, name: project.name },
        occurredAt: now,
      },
    });

    const draft = createWorkItem({
      id: workItemId,
      projectId,
      parentId: null,
      type: 'TASK',
      objective: 'Prove PostgreSQL-backed restart/resume without duplicate semantic work',
      now,
    });
    await workStoreA.createWorkItem(draft);
    const ready = await workStoreA.transitionWorkItem({ workItemId, expectedRevision: draft.revision, to: 'READY' });

    const workPackage: WorkPackage = {
      schemaVersion: WORK_PACKAGE_SCHEMA_VERSION,
      workPackageId: randomUUID(),
      version: 1,
      projectId,
      workItemId,
      completionObjectRef: `work-item:${workItemId}`,
      objective: ready.objective,
      authoritativeInputs: [{ ref: `project:${projectId}`, classification: 'AUTHORITATIVE' }],
      scope: { refs: [`work-item:${workItemId}`] },
      constraints: [],
      authorityContextRef: 'authority://boot-qualification',
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

    const initialAttempt: Attempt = {
      id: attemptId,
      projectId,
      workItemId,
      attemptNumber: 1,
      state: 'NOT_STARTED',
      workPackageVersion: 1,
      agentRunId: null,
      agentAdapterId: null,
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const started = await workStoreA.startAttempt({ attempt: initialAttempt, expectedWorkItemRevision: ready.revision });
    await workStoreA.transitionAttempt({ attemptId, to: 'STARTING' });
    await workStoreA.transitionAttempt({ attemptId, to: 'RUNNING' });
    await workStoreA.transitionWorkItem({ workItemId, expectedRevision: started.workItem.revision, to: 'RUNNING' });

    const providerRegistry = new MockAgentRunRegistry();
    const adapterA = new MockAgentAdapter('INTERRUPTED', providerRegistry);
    const run = await adapterA.start(workPackage, {
      correlationId,
      workflowRunId: 'qualification-process-a',
      attemptId,
      secretRefs: [],
    });
    await workStoreA.bindAgentRun({ attemptId, agentRunId: run.runId, agentAdapterId: adapterA.identify().adapterId });

    await prismaA.$disconnect();
    const prismaB = new PrismaClient();
    try {
      const workStoreB = new WorkStore(prismaB);
      const adapterB = new MockAgentAdapter('SUCCESS', providerRegistry);
      const coordinator = new WorkflowResumeCoordinator(workStoreB);

      const resumed = await coordinator.reconcileAndResume({
        workItemId,
        workPackage,
        adapter: adapterB,
        correlationId: randomUUID(),
        workflowRunId: 'qualification-process-b',
      });

      expect(resumed.disposition).toBe('RECONCILED_EXISTING_RUN');
      expect(resumed.attempt?.id).toBe(attemptId);
      expect(resumed.attempt?.attemptNumber).toBe(1);
      expect(resumed.attempt?.state).toBe('SUCCEEDED');
      expect(resumed.agentResult?.status).toBe('COMPLETED');
      expect(resumed.workItem.lifecycleState).toBe('VERIFICATION_REQUIRED');

      expect(await prismaB.attempt.count({ where: { workItemId } })).toBe(1);
      expect(providerRegistry.runs.size).toBe(1);
      const persisted = await prismaB.attempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(persisted.agentRunId).toBe(run.runId);
      expect(persisted.agentAdapterId).toBe('mock-agent');
    } finally {
      await prismaB.$disconnect();
    }
  });
});
