# Phase B Implementation Plan for REVIEWER-001

This plan details the authorized bounded local implementation for the Independent Reviewer capability, adhering strictly to the Owner's guidance in Issue #4.

## Goal Description
Implement the Reviewer capability by extending the existing `ConcreteStructuredReviewer` and `StructuredReviewer` components without creating parallel structures, while satisfying the canonical ReviewRequest bindings (02.3.1).

## Proposed Changes

### Packages/Contracts
- Modify `packages/contracts/src/reviewer-contracts.ts` to define the canonical `ReviewRequest` and `ReviewVerdict` bindings, including `findingId`, requirement ref, allowed scope, forbidden actions, etc.

### Packages/Workflow
- Modify `packages/workflow/src/run-coordinator.ts` to revert the unauthorized `ReviewerBridge` injection and instead rely purely on the extended `StructuredReviewer`.
- Extend `StructuredReviewer` to include bounded `FAIL_REPAIRABLE` repair-package semantics and `NEEDS_EVIDENCE` autonomous evidence collection.
- Implement Reviewer persistence, currentness checks, stale invalidation, and restart-resume capability within the coordinator.

### Packages/Orchestrator
- Extend `packages/orchestrator/src/concrete-structured-reviewer.ts` to implement the new `StructuredReviewer` extensions. We will inject an `AgentBridge` for the OpenAI/Codex Reviewer binding with a distinct trusted Reviewer identity.
- Ensure deterministic rules (`FAILED` -> `FAIL_REPAIRABLE`, etc.) remain intact.
- Preserve deterministic Completion Evaluator separation.

### Packages/Agents
- Add a provider-neutral Reviewer adapter in `packages/agents/src/reviewer/openai-reviewer-adapter.ts`.
- Ensure it uses the extended `GovernedToolGateway` with Reviewer-specific read/verify/test capabilities, but explicitly denies source mutation.

### Packages/Tools & Policy
- Extend the existing `GovernedToolGateway` and policy context to support the Reviewer identity with strictly read/verify/test permissions.

## Verification Plan
### Automated Tests
- `pnpm run test` across modified packages.
- Ensure existing tests (e.g., `uc-01` to `uc-09`, `no-messenger-e2e.spec.ts`) pass to verify we preserved the canonical Owner-event channel (`OWNER_MESSAGE_RELAY_COUNT=0`) and Completion Evaluator separation.
- Add focused tests for the new Reviewer bounds (persistence, currentness, repair-package semantics).

### Manual Verification
- Output exact worktree attribution, changed paths, tests/exit codes, acceptance matrix with evidence mapping, and residual contamination state before committing.
