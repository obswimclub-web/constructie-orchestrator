# BOOT Qualification Gate — Node 24 + PostgreSQL + CI

Status: **IMPLEMENTED LOCALLY — CI EXECUTION PENDING**

## Purpose

Qualify BOOT-001 through BOOT-010 on the approved runtime and durable PostgreSQL state before any real provider adapter is introduced.

## Gate

A qualification run is valid only when all of the following pass on the exact repository revision:

1. Node.js 24 runtime identity.
2. pnpm 10 runtime identity.
3. committed `pnpm-lock.yaml` and `pnpm install --frozen-lockfile`.
4. Prisma schema validation and client generation.
5. canonical SQL migrations against PostgreSQL 17.
6. lint.
7. TypeScript project-reference typecheck.
8. full Vitest suite.
9. PostgreSQL-backed restart/resume proof with exactly one semantic Attempt and one provider run.
10. build.
11. architecture dependency check.

## Restart/resume acceptance

The PostgreSQL proof must demonstrate that Process B creates a new `PrismaClient`, reloads the same WorkItem/Attempt, reconciles the same `agentRunId`, and reaches `VERIFICATION_REQUIRED` without creating Attempt #2.

Required evidence:

- same `attemptId`;
- `attemptNumber = 1`;
- persisted `agentRunId` unchanged;
- persisted `agentAdapterId = mock-agent`;
- `attempt count(workItemId) = 1`;
- provider registry run count = 1;
- final Attempt state `SUCCEEDED`;
- final WorkItem state `VERIFICATION_REQUIRED`.

## Current blocker

The GitHub repository `obswimclub-web/constructie-orchestrator` is not yet visible to GitHub App installation `154614006`. Until it is visible and a lockfile is generated/committed, the gate cannot produce a truthful PASS.

## Completion rule

> BOOT-001 through BOOT-010 may be promoted to DONE only from a green BOOT Qualification Gate on the exact committed revision. Local structural evidence is insufficient.
