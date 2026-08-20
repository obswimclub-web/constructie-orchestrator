# BOOT-002 — Canonical Project + Event Persistence

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

## Scope

- `Project` canonical aggregate with explicit monotonic revision.
- Append-only `ProjectEvent` lineage.
- Transactional `OutboxEvent` written in the same transaction as canonical state/event changes.
- Optimistic concurrency through `expectedRevision`.
- Stale-write rejection before event/outbox commit.
- PostgreSQL-only persistence contract for integration verification.

## Explicit non-goals

BOOT-002 does not yet implement WorkItem, AgentRun, MOC, authority decisions, event publication workers, snapshots, or full restart orchestration.

## Required target-runtime evidence

1. Node 24 + pnpm 10 install succeeds.
2. Prisma schema validates/generates.
3. PostgreSQL migration applies cleanly.
4. Integration test proves project/event/outbox atomic persistence.
5. Integration test proves stale revision rejection leaves no event/outbox residue.
6. Process restart / new Prisma client can reload current project state.

Until those checks run against the target runtime, BOOT-002 must not be marked DONE.
