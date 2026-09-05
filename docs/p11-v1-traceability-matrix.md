# P11 V1 Canonical Traceability Matrix

This document provides the formal mapping between the canonical product requirements (as defined in `CANON-001`, `02.1`, `02.2`, `02.7`) and the exact repository implementations, test paths, runtime surfaces, and historical acceptance evidence.

| Requirement | Source | Contract / Module | Exact Test Path | Runtime Surface | Evidence Ref | Status |
|---|---|---|---|---|---|---|
| Project creation/import | 02.1 | `packages/domain/src/project/` | `tests/integration/project-persistence.spec.ts` | API, DB | GitHub Commit `7a0dd888b210b75d419b570b2daea547bb5e5dd1` | PASS |
| Hydration/context | 02.2 | `packages/policy/src/context/` | `tests/e2e/bootstrap.spec.ts` | Worker | GitHub Commit `4d161f0c3007e1fc6cb1ea270fef6f8330e08560` | PASS |
| Planning/task graph | 02.7 | `packages/domain/src/work-item.ts` | `tests/domain/work-item-state-machine.spec.ts` | Worker | GitHub Commit `4d161f0c3007e1fc6cb1ea270fef6f8330e08560` | PASS |
| Workflow engine | 02.7 | `packages/workflow/src/minimal-workflow-engine.ts` | `packages/workflow/test/minimal-workflow-engine.spec.ts` | Worker | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Work package lifecycle | 02.1 | `packages/persistence/src/work/` | `tests/domain/work-item-state-machine.spec.ts` | DB, Worker | GitHub Commit `4d161f0c3007e1fc6cb1ea270fef6f8330e08560` | PASS |
| Attempts | 02.7 | `packages/workflow/src/minimal-workflow-engine.ts` | `tests/workflow/reconciliation.spec.ts` | DB, Worker | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Provider routing | 02.2 | `packages/agents/src/` | `tests/agents/provider-qualification.spec.ts` | Worker | GitHub Commit `43bdeac09ddee67d9d02274daba0b12dff3bb438` | PASS |
| Multi-provider abstraction | 02.2 | `packages/contracts/src/agent/` | `tests/agents/codex-adapter.spec.ts`, `tests/agents/mock-agent-adapter.spec.ts` | Worker | GitHub Commit `43bdeac09ddee67d9d02274daba0b12dff3bb438` | PASS |
| Reviewer/judge | 02.2 | `packages/agents/src/reviewer/` | `tests/orchestrator/concrete-reviewer-canonical.spec.ts` | Worker | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Repair loop | 02.7 | `packages/reconciliation/src/` | `tests/e2e/uc-07-recovery-resume.spec.ts` | Worker | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Applicability resolution | 02.7 | `packages/policy/src/engine/` | `tests/policy/policy-engine.spec.ts` | Worker | GitHub Commit `f8dedb6db0b6d43f7e85cbaa17d5eeaf2d06b646` | PASS |
| Completion decision | 02.1 | `packages/completion/src/` | `packages/completion/test/completion-engine.spec.ts` | Worker, API | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Owner approvals | CANON-001 | `packages/persistence/src/work/` | `tests/api/approval.test.ts` | API, DB | GitHub Commit `65f188eba3e0bc6fd1c8b0fe5f86a9b14469d9d9` | PASS |
| Commit gate | CANON-001 | `packages/tools/src/git/` | `tests/tools/structured-git-adapter.spec.ts` | GitHub, Worker | GitHub Commit `f8dedb6db0b6d43f7e85cbaa17d5eeaf2d06b646` | PASS |
| Push gate | CANON-001 | `packages/tools/src/git/` | `tests/tools/governed-gateway-e2e.spec.ts` | GitHub, Worker | GitHub Commit `f8dedb6db0b6d43f7e85cbaa17d5eeaf2d06b646` | PASS |
| Deployment gate | CANON-001 | `packages/tools/src/qualification/` | `tests/e2e/uc-06-release-lifecycle.spec.ts` | Railway, API | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Persistence | 02.2 | `packages/persistence/src/` | `tests/integration/evidence-persistence.spec.ts` | DB | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Restart/resume | CANON-001 | `packages/workflow/src/run-coordinator.ts` | `tests/integration/restart-resume-coordinator.spec.ts` | Worker, DB | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Duplicate execution prevention| CANON-001 | `packages/workflow/src/minimal-workflow-engine.ts` | `tests/integration/restart-resume-postgres.spec.ts` | Worker, DB | GitHub Commit `55c30291eea9bbbc48da8ad76cede8e5e166909e` | PASS |
| Evidence lineage | 02.1 | `packages/evidence/src/` | `tests/evidence/evidence-verification.spec.ts` | DB | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Logs | 02.7 | `packages/persistence/src/observability/` | `tests/observability/logger.spec.ts` | Logs, DB | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Incidents | 02.7 | `packages/persistence/src/observability/` | `tests/integration/durable-observability.spec.ts` | DB | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Reverse traceability | 02.2 | `packages/evidence/src/` | `tests/evidence/evidence-verification.spec.ts` | DB, Notion | GitHub PR `#10` (Commit `01fc90b346211bc0af35490f0d7f17feee2a31ee`) | PASS |
| Security/policy enforcement | CANON-001 | `packages/tools/src/security/` | `tests/e2e/external-host-policy.spec.ts` | Worker, API | GitHub Commit `f8dedb6db0b6d43f7e85cbaa17d5eeaf2d06b646` | PASS |
| API surfaces | 02.2 | `apps/api/src/` | `tests/api/api.test.ts` | API | GitHub Commit `4d161f0c3007e1fc6cb1ea270fef6f8330e08560` | PASS |
| UI surfaces | 02.1 | `apps/web/src/` | `tests/e2e/orchestrator-lifecycle-e2e.spec.ts` | Web | GitHub Commit `0e9a14ad9ea3bc1951ca64061b366bac381bb2cc` and `65f188eba3e0bc6fd1c8b0fe5f86a9b14469d9d9` | PASS |
| Worker runtime | 02.2 | `apps/worker/src/` | `apps/worker/test/worker.test.ts` | Worker | GitHub Commit `1ece2912aae61fe5d1b0abbf1a013e484c801ddf` | PASS |
| Production readiness | CANON-001 | Infrastructure | `tests/e2e/bootstrap.spec.ts` | Railway | GitHub Commit `55c30291eea9bbbc48da8ad76cede8e5e166909e` | PASS |
| Backup/recovery | CANON-001 | `docs/disaster-recovery.md` | Non-destructive DB isolation test (P10-R1) | Railway | GitHub Commit `55c30291eea9bbbc48da8ad76cede8e5e166909e` | PASS |
| Rollback | CANON-001 | Railway Dashboard | Verified via manual observation | Railway | GitHub Commit `55c30291eea9bbbc48da8ad76cede8e5e166909e` | PASS |
| Documentation propagation | 02.1 | `docs/p11-v1-traceability-matrix.md` | Verified via canonical reconciliation | Repo / Notion | `docs/p11-v1-traceability-matrix.md` | PASS |

## Final UI Status
- **UI REQUIRED V1 SURFACES TRACEABILITY**: PASS. Required V1 views are real-data wired, required API mutations are wired, and Owner approval UI is wired natively. No required V1 silent mock fallback remains.

## Documentation Propagation Status
The requirement 02.1 for "documentation propagation" requires synchronizing implementation intent with actual execution and governance truth. This is satisfied strictly by the Execution State Ledger + the repository canonical documentation + `docs/p11-v1-traceability-matrix.md` itself, which consolidates all verified references into durable repository truth.
