# BOOT-004 — AgentAdapter Contract + MockAgentAdapter

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

Implements the provider-neutral execution boundary from 02.7.2:
- versioned and runtime-validated `WorkPackage`;
- `AgentAdapter` lifecycle contract;
- normalized `AgentRunResult` and artifact/evidence candidates;
- deterministic `MockAgentAdapter` scenarios for success, failure, timeout/interruption, waiting-for-input and malformed output;
- malformed raw/provider output is rejected before domain consumption;
- provider/session identifiers do not enter the canonical domain model.

Target-runtime verification still requires Node 24 + pnpm install/typecheck/test.
