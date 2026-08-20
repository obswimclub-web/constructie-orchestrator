# BOOT-005 — Minimal Workflow Engine

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

## Implemented
- `WorkflowWorkStore` persistence port (workflow does not import Prisma/persistence)
- `MinimalWorkflowEngine.execute()`
- WorkItem precondition: `READY`
- WorkPackage ↔ WorkItem/Project binding validation
- explicit Attempt lifecycle: `NOT_STARTED → STARTING → RUNNING → terminal/UNKNOWN`
- `AgentAdapter.start()` + `getResult()` integration
- result routing:
  - `COMPLETED → Attempt SUCCEEDED → WorkItem VERIFICATION_REQUIRED`
  - `FAILED → Attempt FAILED → WorkItem REPAIR_REQUIRED`
  - `INTERRUPTED/CANCELLED → RECOVERY_REQUIRED`
  - `WAITING_FOR_INPUT → WAITING`
  - invalid provider result → `RECOVERY_REQUIRED`
- no direct WorkItem `COMPLETED` transition from agent assertion
- deterministic unit scenarios with `MockAgentAdapter`

## Verification boundary
Architecture dependency check: PASS.
Full TypeScript/Vitest target-runtime verification requires the declared Node 24 environment and installed workspace dependencies.
