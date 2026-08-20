export const WORK_ITEM_LIFECYCLE_STATES = [
  "DRAFT",
  "READY",
  "QUEUED",
  "ASSIGNED",
  "RUNNING",
  "WAITING",
  "BLOCKED",
  "REVIEW_REQUIRED",
  "VERIFICATION_REQUIRED",
  "REPAIR_REQUIRED",
  "RECOVERY_REQUIRED",
  "COMPLETED",
  "CANCELLED",
  "SUPERSEDED",
] as const;

export type WorkItemLifecycleState = (typeof WORK_ITEM_LIFECYCLE_STATES)[number];

export const ATTEMPT_STATES = [
  "NOT_STARTED",
  "STARTING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "INTERRUPTED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const ACTIVE_ATTEMPT_STATES: readonly AttemptState[] = ["NOT_STARTED", "STARTING", "RUNNING", "UNKNOWN"];
export const TERMINAL_ATTEMPT_STATES: readonly AttemptState[] = ["SUCCEEDED", "FAILED", "TIMED_OUT", "INTERRUPTED", "CANCELLED"];

export interface WorkItem {
  readonly id: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly type: "MILESTONE" | "FEATURE" | "TASK" | "SUBTASK" | "RECOVERY_TASK" | "VERIFICATION_TASK" | "REVIEW_TASK" | "AUDIT_TASK" | "DEPLOYMENT_TASK" | "OWNER_ACTION_TASK" | "EXTERNAL_WAIT_TASK";
  readonly objective: string;
  readonly lifecycleState: WorkItemLifecycleState;
  readonly revision: number;
  readonly currentAttemptId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Attempt {
  readonly id: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly attemptNumber: number;
  readonly state: AttemptState;
  readonly workPackageVersion: number;
  readonly agentRunId: string | null;
  readonly agentAdapterId: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const WORK_ITEM_TRANSITIONS: Readonly<Record<WorkItemLifecycleState, readonly WorkItemLifecycleState[]>> = {
  DRAFT: ["READY", "CANCELLED", "SUPERSEDED"],
  READY: ["QUEUED", "ASSIGNED", "BLOCKED", "WAITING", "CANCELLED", "SUPERSEDED"],
  QUEUED: ["ASSIGNED", "READY", "BLOCKED", "WAITING", "CANCELLED", "SUPERSEDED"],
  ASSIGNED: ["RUNNING", "READY", "RECOVERY_REQUIRED", "BLOCKED", "WAITING", "CANCELLED", "SUPERSEDED"],
  RUNNING: ["REVIEW_REQUIRED", "VERIFICATION_REQUIRED", "REPAIR_REQUIRED", "RECOVERY_REQUIRED", "WAITING", "BLOCKED", "COMPLETED", "CANCELLED", "SUPERSEDED"],
  WAITING: ["READY", "BLOCKED", "CANCELLED", "SUPERSEDED"],
  BLOCKED: ["READY", "WAITING", "CANCELLED", "SUPERSEDED"],
  REVIEW_REQUIRED: ["VERIFICATION_REQUIRED", "REPAIR_REQUIRED", "BLOCKED", "WAITING", "COMPLETED", "CANCELLED", "SUPERSEDED"],
  VERIFICATION_REQUIRED: ["COMPLETED", "REPAIR_REQUIRED", "RECOVERY_REQUIRED", "BLOCKED", "WAITING", "CANCELLED", "SUPERSEDED"],
  REPAIR_REQUIRED: ["READY", "BLOCKED", "WAITING", "CANCELLED", "SUPERSEDED"],
  RECOVERY_REQUIRED: ["READY", "WAITING", "BLOCKED", "CANCELLED", "SUPERSEDED"],
  COMPLETED: ["VERIFICATION_REQUIRED", "READY", "SUPERSEDED"],
  CANCELLED: [],
  SUPERSEDED: [],
};

const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  NOT_STARTED: ["STARTING", "CANCELLED"],
  STARTING: ["RUNNING", "FAILED", "TIMED_OUT", "INTERRUPTED", "CANCELLED", "UNKNOWN"],
  RUNNING: ["SUCCEEDED", "FAILED", "TIMED_OUT", "INTERRUPTED", "CANCELLED", "UNKNOWN"],
  UNKNOWN: ["RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "INTERRUPTED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  TIMED_OUT: [],
  INTERRUPTED: [],
  CANCELLED: [],
};

export class InvalidWorkItemTransitionError extends Error {
  public readonly code = "WORK_ITEM_TRANSITION_INVALID";
  public constructor(public readonly from: WorkItemLifecycleState, public readonly to: WorkItemLifecycleState) {
    super(`Invalid WorkItem transition: ${from} -> ${to}`);
    this.name = "InvalidWorkItemTransitionError";
  }
}

export class InvalidAttemptTransitionError extends Error {
  public readonly code = "ATTEMPT_TRANSITION_INVALID";
  public constructor(public readonly from: AttemptState, public readonly to: AttemptState) {
    super(`Invalid Attempt transition: ${from} -> ${to}`);
    this.name = "InvalidAttemptTransitionError";
  }
}

export function assertWorkItemTransition(from: WorkItemLifecycleState, to: WorkItemLifecycleState): void {
  if (!WORK_ITEM_TRANSITIONS[from].includes(to)) throw new InvalidWorkItemTransitionError(from, to);
}

export function assertAttemptTransition(from: AttemptState, to: AttemptState): void {
  if (!ATTEMPT_TRANSITIONS[from].includes(to)) throw new InvalidAttemptTransitionError(from, to);
}

export function isActiveAttemptState(state: AttemptState): boolean {
  return ACTIVE_ATTEMPT_STATES.includes(state);
}

export function createWorkItem(input: Omit<WorkItem, "lifecycleState" | "revision" | "currentAttemptId" | "createdAt" | "updatedAt"> & { now: Date }): WorkItem {
  return {
    id: input.id,
    projectId: input.projectId,
    parentId: input.parentId,
    type: input.type,
    objective: input.objective,
    lifecycleState: "DRAFT",
    revision: 1,
    currentAttemptId: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
