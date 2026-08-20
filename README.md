# Constructie Orchestrator

Provider-neutral, durable AI orchestration platform for software development.

## BOOT-001 status

This repository is the initial monorepo scaffold defined by `02.7.6 — Repository Structure & Build Order`.

### Required runtime

- Node.js 24 LTS
- pnpm 10+
- Docker / Docker Compose

### Local bootstrap

```bash
corepack enable
pnpm install
docker compose up -d
pnpm ci
```

## Architectural rule

The domain core must not depend on provider SDKs, persistence, queues, HTTP frameworks, or external tool implementations.
## Current implementation checkpoint

- BOOT-001: scaffolded locally; target-runtime/GitHub verification pending.
- BOOT-002: canonical Project/Event/Outbox persistence implemented locally; target-runtime verification pending.
- BOOT-003: WorkItem + Attempt state machine implemented locally; target-runtime verification pending.

## BOOT-005 checkpoint

Implemented locally: `MinimalWorkflowEngine` connects `WorkItem READY` to explicit `Attempt` creation, `AgentAdapter.start()`, normalized `AgentRunResult`, and guarded WorkItem transitions. Agent `COMPLETED` maps to `VERIFICATION_REQUIRED`, not WorkItem/project completion. Agent `FAILED` maps to `REPAIR_REQUIRED`; malformed/ambiguous execution maps to `RECOVERY_REQUIRED`.

Target-runtime verification remains pending until Node 24 + workspace dependencies can be executed end-to-end.


## BOOT-006

Governed Tool Gateway, static policy V0, MockToolAdapter and sandbox filesystem containment are implemented locally. Target-runtime verification remains pending.

## BOOT-008 checkpoint

Completion Engine V0 now separates `WorkItem COMPLETED` from outcome completion. `CompletionDecision` is bound to exact project/work revisions, current evidence, PASS verification and explicit reconciliation PASS.

## BOOT-009 checkpoint

Reconciliation V0 and the first deterministic end-to-end outcome are implemented locally. The E2E proves the governed path from Project/WorkPackage through MockAgent + Tool Gateway + Evidence/Verification + Reconciliation to CompletionDecision `COMPLETE`.

## BOOT-010 — Restart / Resume Proof

Implemented locally. Attempt-to-provider run binding is durable, a new Orchestrator process can reconcile/resume the same Attempt through `WorkflowResumeCoordinator`, and the deterministic restart test asserts no duplicate semantic Attempt/provider run. Target-runtime Node 24 + dependency + PostgreSQL verification remains pending.

## BOOT Qualification Gate

The repository now contains a dedicated Node 24 + PostgreSQL qualification workflow at `.github/workflows/qualification.yml` and a PostgreSQL-backed restart/resume proof at `tests/integration/restart-resume-postgres.spec.ts`.

Current status: **IMPLEMENTED LOCALLY — CI EXECUTION PENDING**.
