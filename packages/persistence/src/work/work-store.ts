import type { PrismaClient } from "@prisma/client";
import {
  InvalidAttemptTransitionError,
  InvalidWorkItemTransitionError,
  assertAttemptTransition,
  assertWorkItemTransition,
  isActiveAttemptState,
  type Attempt,
  type AttemptState,
  type WorkItem,
  type WorkItemLifecycleState,
} from "@co/domain";

export class WorkItemRevisionConflictError extends Error {
  public readonly code = "WORK_ITEM_REVISION_CONFLICT";
  public constructor(public readonly workItemId: string, public readonly expectedRevision: number) {
    super(`WorkItem ${workItemId} is no longer at expected revision ${expectedRevision}.`);
    this.name = "WorkItemRevisionConflictError";
  }
}

export class ActiveAttemptExistsError extends Error {
  public readonly code = "ACTIVE_ATTEMPT_EXISTS";
  public constructor(public readonly workItemId: string) {
    super(`WorkItem ${workItemId} already has an active attempt.`);
    this.name = "ActiveAttemptExistsError";
  }
}

function mapWorkItem(row: unknown): WorkItem { return row as WorkItem; }
function mapAttempt(row: unknown): Attempt { return row as Attempt; }

export class WorkStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createWorkItem(workItem: WorkItem): Promise<WorkItem> {
    const row = await this.prisma.workItem.create({ data: {
      id: workItem.id,
      projectId: workItem.projectId,
      parentId: workItem.parentId,
      type: workItem.type,
      objective: workItem.objective,
      lifecycleState: workItem.lifecycleState,
      revision: workItem.revision,
      currentAttemptId: workItem.currentAttemptId,
      createdAt: workItem.createdAt,
      updatedAt: workItem.updatedAt,
    }});
    return mapWorkItem(row);
  }

  public async transitionWorkItem(input: { workItemId: string; expectedRevision: number; to: WorkItemLifecycleState }): Promise<WorkItem> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.workItem.findUniqueOrThrow({ where: { id: input.workItemId } });
      if (current.revision !== input.expectedRevision) throw new WorkItemRevisionConflictError(input.workItemId, input.expectedRevision);
      assertWorkItemTransition(current.lifecycleState as WorkItemLifecycleState, input.to);
      const row = await tx.workItem.update({ where: { id: input.workItemId }, data: { lifecycleState: input.to, revision: { increment: 1 } } });
      return mapWorkItem(row);
    });
  }

  public async startAttempt(input: { attempt: Attempt; expectedWorkItemRevision: number }): Promise<{ workItem: WorkItem; attempt: Attempt }> {
    return this.prisma.$transaction(async (tx) => {
      const work = await tx.workItem.findUniqueOrThrow({ where: { id: input.attempt.workItemId } });
      if (work.revision !== input.expectedWorkItemRevision) throw new WorkItemRevisionConflictError(work.id, input.expectedWorkItemRevision);
      assertWorkItemTransition(work.lifecycleState as WorkItemLifecycleState, "ASSIGNED");

      const existing = await tx.attempt.findFirst({ where: { workItemId: work.id, active: true } });
      if (existing) throw new ActiveAttemptExistsError(work.id);

      const createdAttempt = await tx.attempt.create({ data: {
        id: input.attempt.id,
        projectId: input.attempt.projectId,
        workItemId: input.attempt.workItemId,
        attemptNumber: input.attempt.attemptNumber,
        state: input.attempt.state,
        active: isActiveAttemptState(input.attempt.state),
        workPackageVersion: input.attempt.workPackageVersion,
        agentRunId: input.attempt.agentRunId,
        agentAdapterId: input.attempt.agentAdapterId,
        startedAt: input.attempt.startedAt,
        endedAt: input.attempt.endedAt,
        createdAt: input.attempt.createdAt,
        updatedAt: input.attempt.updatedAt,
      }});
      const updatedWork = await tx.workItem.update({ where: { id: work.id }, data: { lifecycleState: "ASSIGNED", currentAttemptId: createdAttempt.id, revision: { increment: 1 } } });
      return { workItem: mapWorkItem(updatedWork), attempt: mapAttempt(createdAttempt) };
    });
  }

  public async getWorkItem(workItemId: string): Promise<WorkItem> {
    const row = await this.prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    return mapWorkItem(row);
  }

  public async getAttempt(attemptId: string): Promise<Attempt> {
    const row = await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    return mapAttempt(row);
  }

  public async bindAgentRun(input: { attemptId: string; agentRunId: string; agentAdapterId: string }): Promise<Attempt> {
    const row = await this.prisma.attempt.update({
      where: { id: input.attemptId },
      data: { agentRunId: input.agentRunId, agentAdapterId: input.agentAdapterId },
    });
    return mapAttempt(row);
  }

  public async transitionAttempt(input: { attemptId: string; to: AttemptState }): Promise<Attempt> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.attempt.findUniqueOrThrow({ where: { id: input.attemptId } });
      assertAttemptTransition(current.state as AttemptState, input.to);
      const active = isActiveAttemptState(input.to);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        state: input.to,
        active,
        endedAt: active ? null : new Date(),
      };
      if (input.to === "RUNNING" && current.startedAt === null) {
        updateData.startedAt = new Date();
      }
      const row = await tx.attempt.update({ where: { id: input.attemptId }, data: updateData });
      if (!active) {
        await tx.workItem.updateMany({ where: { id: current.workItemId, currentAttemptId: current.id }, data: { currentAttemptId: null } });
      }
      return mapAttempt(row);
    });
  }
}

void InvalidWorkItemTransitionError;
void InvalidAttemptTransitionError;
