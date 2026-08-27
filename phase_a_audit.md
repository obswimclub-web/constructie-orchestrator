CONSTITUTION_HYDRATED=true
CONSTITUTION_FIRST=true
CONSTITUTION_CONFLICTS_FOUND=none

### PHASE A — READ-ONLY BASELINE AUDIT

#### 1. Baseline Integrity Statement
This audit inspected the exact `HEAD` baseline of the repository, ignoring any unauthorized mutations previously applied by REVIEWER-001 in the contaminated local tree. Zero source mutations were performed during this re-audit.

#### 2. Claim Verifications

**CONCRETE_STRUCTURED_REVIEWER_REUSE = PARTIAL (EXTEND instead of REPLACE)**
- **Baseline path:** `packages/orchestrator/src/concrete-structured-reviewer.ts`
- **Baseline symbol:** `ConcreteStructuredReviewer`
- **Difference:** The contaminated tree deleted this file completely.
- **Conclusion:** We can **EXTEND** this component rather than replacing it. The baseline component is a synchronous rules-engine implementing the `StructuredReviewer` seam. Instead of removing it, we can inject an `AgentBridge` (configured with the Reviewer identity) into it. The deterministic rules (like `FAILED` → `FAIL_REPAIRABLE`) remain intact, while `COMPLETED` runs can be forwarded to the LLM reviewer for technical validation.

**PROVIDER_NEUTRAL_REVIEWER_SEAM_PRESENT = YES**
- **Baseline path:** `packages/workflow/src/run-coordinator.ts`
- **Baseline symbol:** `StructuredReviewer` interface
- **Evidence:** `reviewExecution(result: AgentRunResult): Promise<ConcreteReviewDecision>`
- **Conclusion:** The runtime abstraction needed for provider substitution already exists at `StructuredReviewer`. We do not need a new `ReviewerBridge` or `ReviewRequest/ReviewVerdict` contract; we can reuse `AgentRunResult` and `ConcreteReviewDecision`.

**OPENAI_REVIEWER_BINDING_PRESENT = NO**
- **Baseline path:** `packages/agents/package.json` & `packages/agents/src/codex/`
- **Evidence:** `grep -i openai HEAD:packages/` shows only `CodexAdapter`.
- **Conclusion:** No `OpenAIReviewerAdapter` exists in the baseline.

**REVIEW_STATE_PERSISTENCE_PRESENT = PARTIAL**
- **Baseline path:** `packages/workflow/src/run-coordinator.ts`
- **Evidence:** `await emit('EVALUATION_PASSED', { attemptId, nextAction: review.nextAction });`
- **Conclusion:** The coordinator persists the outcome of the review via `RUN_BLOCKED`, `EVALUATION_PASSED`, etc., but does not persist the raw Reviewer reasoning (e.g. LLM transcript) in a distinct `REVIEW_VERDICT_RECORDED` ledger event.

**REVIEW_RESTART_RESUME_PRESENT = YES**
- **Baseline path:** `packages/workflow/src/run-coordinator.ts`
- **Evidence:** `resumeWithAuthority` reconstructs `RunState` from ledger events.
- **Conclusion:** Resumption mechanics are fully present for the existing state machine.

**GOVERNED_REVIEWER_TOOL_SURFACE_PRESENT = NO**
- **Baseline path:** `packages/tools/src/`
- **Conclusion:** No read-only Reviewer tool policies exist in baseline.

**AUTONOMOUS_REPAIR_LOOP_PRESENT = YES**
- **Baseline path:** `packages/workflow/src/run-coordinator.ts`
- **Evidence:** `if (review.decision === 'FAIL_REPAIRABLE') { repairAttempts++; state = 'REPAIRING'; }`
- **Conclusion:** The repair loop is already implemented.

**AUTONOMOUS_EVIDENCE_LOOP_PRESENT = NO**
- **Baseline path:** `packages/workflow/src/run-coordinator.ts`
- **Conclusion:** The state machine lacks a `NEEDS_EVIDENCE` loop to drive autonomous collection when the Reviewer lacks information.

**COMPLETION_EVALUATOR_SEPARATE = YES**
- **Baseline path:** `packages/completion/src/engine.ts`
- **Evidence:** The CMO engine handles final completion logic, fully decoupled from `StructuredReviewer`.
- **Conclusion:** Separation of concerns is maintained.

**OWNER_MESSAGE_RELAY_CURRENTLY_REQUIRED = YES**
- **Baseline path:** `packages/orchestrator/src/concrete-structured-reviewer.ts`
- **Evidence:** Automatically transitions to `OWNER_DECISION_REQUIRED` for any `requestedInputs`.
- **Conclusion:** Since the baseline reviewer is not an LLM, it requires Owner relay for any technical decision.

#### 3. Exact Implementation Gap List
1. `ConcreteStructuredReviewer` lacks integration with an `AgentBridge` to query an LLM when the executor completes.
2. No `OpenAIReviewerAdapter` exists to back the `AgentBridge` for the Reviewer identity.
3. No `NEEDS_EVIDENCE` state or loop exists in `RunCoordinator` or `ReviewDecision`.
4. No specific `REVIEW_VERDICT_RECORDED` event is defined in `ProjectEvent` payloads.
5. No read-only Reviewer `GovernedToolGateway` policy is defined in `ActionClassifyingPolicyEngine`.

#### 4. Exact Proposed Implementation Files
- **[MODIFY]** `packages/orchestrator/src/concrete-structured-reviewer.ts` (Inject `AgentBridge` for LLM review instead of deleting the class)
- **[NEW]** `packages/agents/src/reviewer/openai-reviewer-adapter.ts` (Implements `AgentBridge` using OpenAI)
- **[MODIFY]** `packages/workflow/src/run-coordinator.ts` (Add `NEEDS_EVIDENCE` logic and `REVIEW_VERDICT_RECORDED` event)
- **[MODIFY]** `packages/policy/src/engine/action-classifying-policy-engine.ts` (Add Reviewer identity read-only tool constraints)
- **[MODIFY]** `packages/orchestrator/src/runtime-composition.ts` (Wire the `OpenAIReviewerAdapter` into `ConcreteStructuredReviewer`)

#### 5. Exact Test Files/Scenarios
- **[NEW]** `tests/agents/reviewer-adapter.spec.ts` (Verifies OpenAI mapping for Reviewer)
- **[MODIFY]** `tests/workflow/run-coordinator.spec.ts` (Adds tests for the `NEEDS_EVIDENCE` loop)
- **[MODIFY]** `tests/orchestrator/concrete-structured-reviewer.spec.ts` (Verifies fallback and LLM delegation logic)
- **[MODIFY]** `tests/policy/policy-engine.spec.ts` (Verifies Reviewer cannot mutate source)

#### 6. Contamination-Aware Scope Boundaries
All implementation work will be applied by restoring the `HEAD` baseline of `packages/orchestrator/src/concrete-structured-reviewer.ts` to clear the contamination, and cleanly patching the components identified above. `REVIEWER-001` will not bypass or duplicate the existing `AgentBridge` interface.

NEXT_EXECUTABLE_ACTION=Wait for implementation gate authorization
