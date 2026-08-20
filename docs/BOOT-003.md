# BOOT-003 — WorkItem + Attempt State Machine

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

## Implemented
- Canonical `WorkItemLifecycleState` and `AttemptState` enums.
- Explicit transition guards; no arbitrary state assignment is considered legitimate.
- `WorkItem` revision for optimistic concurrency.
- `Attempt` lineage with `attemptNumber` and `workPackageVersion`.
- Database-enforced at-most-one active attempt per WorkItem using a partial unique index.
- `currentAttemptId` lifecycle maintained by persistence operations.
- Terminal attempts cannot be restarted; `UNKNOWN` is retained as an ambiguity state.
- Unit scenarios for valid minimal flow and invalid jumps.

## Minimal executable path
`DRAFT -> READY -> ASSIGNED -> RUNNING -> VERIFICATION_REQUIRED -> COMPLETED`

This is WorkItem completion only. It does not imply project or outcome completion.

## Verification boundary
Architecture dependency check can be executed in the current environment. Full TypeScript/Prisma/PostgreSQL verification remains pending on the Node 24 target runtime.
