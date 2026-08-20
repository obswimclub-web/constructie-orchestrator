export const PROJECT_LIFECYCLE_STATES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];

export interface Project {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly lifecycleState: ProjectLifecycleState;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProjectInput {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly now: Date;
}

export function createProject(input: CreateProjectInput): Project {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    lifecycleState: "ACTIVE",
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
