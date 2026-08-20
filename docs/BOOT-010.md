# BOOT-010 — Restart / Resume Proof

Status: **IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING**

## Objective

Prove that an Orchestrator process restart does not erase canonical execution state, does not silently duplicate semantic work, and can reconcile/resume an existing provider run from persisted lineage.

## Implementation

- `Attempt` now persists `agentRunId` and `agentAdapterId`.
- `WorkStore` can reload WorkItem/Attempt state and bind an external agent run to an Attempt.
- `MinimalWorkflowEngine` persists the provider run binding immediately after `AgentAdapter.start()` returns.
- `WorkflowResumeCoordinator` reloads the current WorkItem + Attempt, validates scope and adapter identity, queries provider status, resumes where legitimate, and reconciles the existing Attempt into the canonical workflow state.
- Missing/ambiguous provider state routes to `RECOVERY_REQUIRED`; it does not create a hidden replacement Attempt.
- `MockAgentRunRegistry` separates mock-provider runtime from adapter instance lifetime so a fresh adapter instance can reconnect to an existing provider run after an Orchestrator restart.

## Restart proof scenario

1. Process A has one WorkItem in `RUNNING` and one active Attempt (`attemptNumber = 1`).
2. The Attempt is bound to one external provider `agentRunId`.
3. Process A disappears before normalizing the provider result.
4. Process B starts with a new `WorkflowResumeCoordinator` and a new adapter instance.
5. Process B reloads persisted WorkItem + Attempt state.
6. It queries/resumes the same external provider run.
7. It reconciles the same Attempt to `SUCCEEDED` and WorkItem to `VERIFICATION_REQUIRED`.
8. Attempt count remains exactly one and provider run count remains exactly one.

## Core invariants

- Restart does not reset authority or execution lineage.
- Provider session/run identity is metadata attached to the canonical Attempt, never canonical project truth by itself.
- An active or ambiguous Attempt must be reconciled before any replacement semantic Attempt can be created.
- Resume reuses the existing Attempt when the provider run is recoverable.
- Missing provider state becomes explicit recovery work, never implicit success/failure.
- `WorkItem COMPLETED` and outcome completion remain downstream evidence/completion concerns.

## Evidence available in this environment

- Architecture dependency check: PASS.
- BOOT-010 restart/resume test scenario is present in `tests/restart/restart-resume.spec.ts`.
- Node runtime available here: v22.16.0; project baseline remains Node 24.
- Dependencies are not installed in the current execution environment, therefore TypeScript/Vitest/Prisma/PostgreSQL target-runtime execution is still pending.

## Completion boundary

BOOT-010 is not declared DONE until Node 24 target-runtime verification executes the restart/resume scenario with the repository dependencies installed and, for final BOOT qualification, canonical PostgreSQL persistence is validated across actual process restart.
