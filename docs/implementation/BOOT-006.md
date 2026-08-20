# BOOT-006 — Tool Gateway + Mock / Sandbox Tools

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

## Outcome

Introduces the first governed tool boundary. Agents and Orchestrator modules submit a canonical `ToolExecutionRequest`; a policy evaluator decides whether execution is allowed; only an `ALLOW` decision can be transformed into an `AuthorizedToolRequest` and reach a tool adapter.

## Implemented

- provider-neutral `ToolExecutionRequest` / `ToolExecutionResult` contracts
- `ToolPolicyEvaluator` boundary
- `GovernedToolGateway`
- deterministic `StaticToolPolicy` V0
- `MockToolAdapter` with SUCCESS / FAIL / TIMEOUT / UNKNOWN scenarios
- `SandboxFilesystemAdapter`
- real path containment via resolved allowed roots
- DENY produces no adapter side effect
- UNKNOWN/TIMEOUT can require reconciliation
- runtime schema validation before and after adapters

## Intentionally deferred

- full Authority Engine integration
- credential broker / secret store
- terminal command adapter
- Git/GitHub adapters
- durable ToolExecution persistence/audit ledger
- idempotency storage
- destructive-operation controls beyond V0 policy

## Locked invariant demonstrated

`tool discovered/exposed != tool authorized`.

An adapter cannot be reached through `GovernedToolGateway` unless the current policy decision is `ALLOW`.

## Verification boundary

Architecture/source-level verification can run in the current environment. Full project typecheck/test remains pending on the official Node 24 target runtime with dependencies installed.
