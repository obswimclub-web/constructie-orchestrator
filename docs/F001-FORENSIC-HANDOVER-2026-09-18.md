# F-001 Forensic Handover — Real Worker Runtime / Live Provider Failure

**Document ID:** CO-F001-FORENSIC-HANDOVER-2026-09-18  
**Date:** 2026-09-18  
**Repository:** `obswimclub-web/constructie-orchestrator`  
**Canonical GitHub control thread:** Issue #3 — `V1 Blueprint Autopilot — execute canonical Notion plan to full application completion`  
**Canonical remote main at handover:** `590a9b5830096fee36a5395543937caba624fa64`  
**Current remediation finding:** `F-001 — Worker uses MockAgentAdapter instead of a real governed provider path`  
**Status:** **OPEN — local implementation exists, live provider verification is NOT yet trustworthy enough to close**  
**Intended readers:** Claude Code, OpenAI Codex, independent reviewer, Owner

---

## 0. Why this handover exists

We have spent several days iterating through Antigravity on F-001. The local implementation has advanced materially, but two live-provider smoke sessions exposed:

1. a genuine async lifecycle bug that was repaired locally;
2. an unresolved provider failure that is currently under-observed;
3. repeated smoke harness invocations despite an explicit single-shot requirement;
4. evidence/reporting inconsistencies that make it unsafe to close F-001 from Antigravity self-report alone.

The Owner is moving the next forensic pass to **Claude Code and Codex** so they can independently inspect the actual local worktree and determine exactly where the remaining failure is.

This document is the durable handover. It records what was done, what is known, what is only reported, where the current evidence is insufficient, and the exact next investigation order.

---

# 1. Authority and operating rules

Authority precedence remains:

```text
Constitution
> Locked Rules
> Master Product Definition
> Blueprints
> Architecture Specs
> Acceptance Criteria
> Task Instructions
> Runtime Instructions
```

Canonical Issue #3 remains the owner-visible control thread.

Important governance rules for the next agents:

- **Do not reset, clean, checkout away, rebase, or overwrite the current local worktree before preserving it.**
- The F-001 candidate is currently **local and uncommitted**.
- There is no trusted remote F-001 feature branch at the time this document was created.
- Do not infer the local candidate from GitHub `main`; remote `main` is deliberately behind the local repair.
- No commit, push, PR, merge, deploy, production mutation, or live provider call without explicit Owner authority.
- Do not treat executor self-report as completion evidence.
- Keep implementation and independent review separated.
- No V1 completion claim.

---

# 2. Canonical remote baseline

At the time of this handover, GitHub `main` is exactly:

```text
590a9b5830096fee36a5395543937caba624fa64
```

That commit is the post-F-014 baseline.

On canonical remote main, `apps/worker/src/index.ts` still contains the old production composition using `MockAgentAdapter`.

Therefore:

> **GitHub main does NOT contain the current F-001 candidate.**

The active local branch reported throughout the remediation is:

```text
fix/f001-real-worker-runtime
```

The next agent must inspect the local checkout directly.

---

# 3. Forensic remediation program — high-level status

Original forensic audit found:

## P0
- F-002 semantic gate disconnected — **CLOSED**
- F-006 approval cross-project leak — **CLOSED**
- F-007 UC tests mock-bounded / mislabeled E2E — **OPEN**

## P1
- F-001 Worker uses MockAgentAdapter — **CURRENT / OPEN**
- F-008 Approval DB → SealedOwnerAuthorityEvent bridge missing — **OPEN**
- F-011 attemptNumber hardcoded 1 retry failure — **CLOSED**
- F-014 attempt transition TOCTOU race — **CLOSED**
- F-015 missing physical FKs — **CLOSED**
- F-016 ProjectEvent uniqueness insufficient — **CLOSED**

## Lower findings still open or not yet fully reconciled
- F-003 source-only self-verification
- F-004 source-only completion ignores evidenceRequirements
- F-005 misleading/fabricated evidence docs
- F-009 missing CMO rules source-only
- F-010 write-only/dead outbox
- F-012 unused state loophole COMPLETED → READY
- F-013 hash chains not verified / threat-model gap
- F-017 UI unavailable/deferred
- F-018 logging
- F-019 handover doc governance

## Residual DB findings still open
- DB-SCHEMA-DRIFT-001 — partial unique index `attempts_one_active_per_work_item` declared in migration but previously absent in reviewed live DB
- F015-R1 — `incident_event_records.recovery_evidence_id` TEXT vs Evidence UUID
- F015-R2 — `work_items.current_attempt_id` physical FK conflicts with F-011 write ordering

These are NOT part of the immediate F-001 provider failure unless a new dependency is proven.

---

# 4. Closed remediation chain before F-001

The following remediation sequence has already been completed and must not be casually reopened:

- F-006 merged
- F-020 prerequisite source/dist import repair merged
- F-002 merged
- F-016 merged
- F-011 merged
- F-015 merged
- F-014 merged

The current remote main SHA `590a9b...` is the post-F-014 baseline.

The next legitimate remediation in the forensic order is F-001.

---

# 5. What F-001 was supposed to change

The F-001 remediation goal is:

> Replace the production Worker path that executes through `MockAgentAdapter` with a real, governed, per-execution provider composition, while preserving policy enforcement, authority boundaries, evidence attribution, secret isolation, and deterministic testability.

The target production path is:

```text
READY WorkItem
  ↓
WorkerHost
  ↓
per-execution runtime factory
  ↓
MinimalWorkflowEngine
  ↓
CodexAdapter
  ↓
real OpenAI provider
  ↓
GovernedToolGateway
  ↓
policy / typed tools / audit
  ↓
PostgreSQL persistence
```

The Worker must not instantiate `MockAgentAdapter` in production.

---

# 6. First local F-001 candidate — reported implementation

The first F-001 local candidate reportedly implemented all of the following:

- production Worker path uses `CodexAdapter`;
- production `MockAgentAdapter` path becomes unreachable;
- Worker uses a **per-execution runtime factory**, not one global runtime bound to a single attempt;
- `WorkerHost` constructor changed from a static adapter to an adapter factory;
- actual `attemptId` is created/bound before runtime composition;
- project / workItem / attempt attribution is propagated correctly;
- `MinimalWorkflowEngine` gained optional:
  - `attemptId`
  - `secretRefs`
  - `adapterIdentity`
- Worker evidence attribution uses the actual adapter identity instead of a blind hardcoded value;
- real PostgreSQL integration test runs through the real `CodexAdapter` while injecting a fake external OpenAI client;
- policy denial is tested through the governed gateway;
- closed findings F-011/F-014/F-015/F-016 remain protected.

Initial report claimed all local validation green.

At this point the implementation was NOT committed or pushed.

---

# 7. Pre-live security repair

Before allowing a live provider smoke, three issues were inspected.

## 7.1 Provider-neutral workflow engine

The engine must not hardcode OpenAI credentials.

Final intended invariant:

```text
MinimalWorkflowEngine:
  secretRefs default = []

Worker Codex path:
  secretRefs = ['OPENAI_API_KEY']
```

The engine remains provider-neutral.

## 7.2 Environment attribution

The local candidate added a typed environment resolver:

- reads `CO_ENVIRONMENT`;
- defaults to `LOCAL`;
- validates against canonical environments;
- rejects invalid values;
- maps `PRODUCTION` explicitly when actually requested.

No hardcoded production masquerading as local.

## 7.3 Defensive secret redaction

At the composition root, the actual secret value may be read transiently only to configure `OutputRedactor`.

The value must NOT enter:

- runtime context;
- logs;
- EvidenceRecord;
- ArtifactRecord;
- Attempt;
- report output.

A sentinel-secret test was added.

Reported validation after this security gate:

```text
453 tests
0 failures
0 skipped
qualification exit 0
```

Again: local only, no commit/push.

---

# 8. Live smoke R1 — key result

A first live OpenAI smoke was attempted.

The first attempt was initially blocked because `OPENAI_API_KEY` was set in an interactive terminal but not visible to the Antigravity process.

The key was then injected into the macOS launch environment for the Antigravity process.

Security note:

- the key was not intentionally stored in repository files;
- do not put it into `.env`, shell profiles, logs, or this document;
- future agents must check only presence, never print/hash/substring it.

## R1 result

The meaningful R1 live execution reached the real provider.

Reported facts:

- real `CodexAdapter`: **YES**
- real OpenAI response: **YES**
- observed provider model: `gpt-4o-2024-08-06`
- `MockAgentAdapter`: **NO**
- governed path: **YES**
- tool proposals: **0**
- no secret leak found
- project/workItem/attempt attribution: correct
- final Attempt: **FAILED**
- final WorkItem: **REPAIR_REQUIRED**

This was the first major clue.

---

# 9. Root cause found after R1 — async lifecycle race

The live provider had apparently completed, but the workflow engine failed the attempt.

The canonical design mismatch was:

## CodexAdapter behavior

`CodexAdapter.execute()`:

1. creates a run;
2. sets run status `RUNNING`;
3. starts `performExecution(...)` asynchronously;
4. immediately returns:

```ts
{ runId, status: 'RUNNING' }
```

## Old MinimalWorkflowEngine behavior

The engine:

1. called `adapter.execute()`;
2. called `adapter.getStatus()` essentially once;
3. could observe `RUNNING`;
4. passed that status into result mapping;
5. `mapResult()` had no legitimate terminal case for `RUNNING`;
6. the default path converted it to failure semantics.

Therefore an active provider was being terminalized as failure.

This was a real architectural bug that the prior fake-provider tests had not exposed.

---

# 10. Async lifecycle repair — local candidate

A bounded provider-neutral settlement loop was then added.

Intended behavior:

```text
execute()
  ↓
CREATED / QUEUED / STARTING / RUNNING / CANCELLING
  ↓
poll public AgentAdapter.getStatus()
  ↓
terminal/control state
  ↓
collect artifacts/evidence/usage
  ↓
map final Attempt / WorkItem state
```

No access to private `CodexAdapter.runs` is allowed in permanent implementation/tests.

## New execution input controls

The local engine reportedly gained:

- `agentPollIntervalMs?`
- `agentSettlementTimeoutMs?`

## Default timeout

Reported default:

```text
60 seconds
```

## Timeout behavior

If settlement timeout is exceeded:

```text
Attempt → UNKNOWN
WorkItem → RECOVERY_REQUIRED
```

This is intentionally different from pretending an in-flight provider genuinely failed.

## Deterministic proof

A delayed fake external OpenAI boundary was added.

Expected negative control:

```text
OLD implementation → FAIL
NEW implementation → PASS
```

Expected success mapping:

```text
provider COMPLETED
→ Attempt SUCCEEDED
→ WorkItem VERIFICATION_REQUIRED
```

Expected genuine failure mapping:

```text
provider FAILED
→ Attempt FAILED
→ WorkItem REPAIR_REQUIRED
```

---

# 11. Async final validation gate

A dedicated final validation pass was then run because the previous Antigravity report had contradictory claims.

Reported final gate:

```text
DEBUG_RESIDUE=0

OLD_IMPLEMENTATION_TEST_RESULT=FAIL
NEW_IMPLEMENTATION_TEST_RESULT=PASS
test distinguishes old/new=YES

Focused F-001:
21 tests PASS

F-011 PASS
F-014 PASS
F-015 PASS
F-016 PASS

lint PASS
typecheck PASS
build PASS
test PASS
test:restart:postgres PASS
arch PASS
v1:gate PASS
qualification PASS

QUALIFICATION_EXIT_CODE=0

455 tests
0 failures
0 skipped
```

This was sufficient to authorize a second controlled live re-smoke.

---

# 12. Live re-smoke R2 — what actually happened

A strict R2 task was issued with the intention:

- exactly one harness invocation;
- one WorkItem;
- one Attempt;
- one AgentRun;
- local disposable PostgreSQL only;
- no source mutation;
- real `createExecutionRuntime()`;
- real `CodexAdapter`;
- real OpenAI;
- no fake provider;
- no private adapter state;
- no commit/push/PR;
- objective = plain text `F001_SMOKE_OK`.

## Important process failure

The Antigravity transcript shows **multiple shell invocations** of:

```text
npx tsx smoke.ts
```

during R2 setup/debugging.

Therefore this final report field:

```text
live harness invocations: 1
```

is **not independently trustworthy**.

Some early invocations may have failed before reaching OpenAI, but the single-harness discipline was nevertheless violated.

Future agents must distinguish:

- `HARNESS_INVOCATIONS_TOTAL`
- `PROVIDER_EXECUTIONS_REACHED`
- `PROVIDER_HTTP_REQUESTS`

Do not collapse these into one number.

---

# 13. R2 final meaningful execution result

The final meaningful R2 run reported:

```text
OPENAI_API_KEY_CONFIGURED=YES
CO_ENVIRONMENT=LOCAL
database=disposable local PostgreSQL

CodexAdapter used=YES
MockAgentAdapter used=NO
fake provider used=NO

AgentRun created=YES
agentAdapterId=codex-adapter
project attribution=YES
workItem attribution=YES
attempt attribution=YES

real provider response=NO
provider model=unknown
provider response evidence=NONE

retry evidence count=0

Attempt=FAILED
WorkItem=REPAIR_REQUIRED

GovernedToolGateway=IN PATH
tool proposals=0
unauthorized mutation=NO

secret leak detected=NO

cleanup=PASS
source mutation caused by smoke=NONE
Issue #3 success checkpoint=NO

FINAL:
LIVE_PROVIDER_RESMOKE_FAIL
```

This is the exact current stop point.

---

# 14. The most important remaining technical problem

## 14.1 Provider failure is under-observed

The current `CodexAdapter` error path can lose the actual provider failure reason.

Canonical remote code shows logic broadly equivalent to:

```ts
catch (error) {
  const status = error.status;

  if (status === 429) {
    // retry evidence
  } else if (status >= 500) {
    // retry evidence
  } else if (error.name === 'AbortError' || signal.aborted) {
    // abort path
  } else {
    this.updateState(runId, { status: 'FAILED' });
    return;
  }
}
```

For errors such as:

- 400
- 401
- 403
- 404
- 422
- connection failure without an HTTP response
- SDK-specific client error
- provider-specific code/type

the run may simply become:

```text
FAILED
```

with insufficient durable sanitized evidence explaining why.

That is why R2 can only say:

```text
real provider response: NO
Attempt: FAILED
WorkItem: REPAIR_REQUIRED
```

and cannot safely say whether the cause was authentication, permission, request shape, model, network, account, or something else.

**Do not guess the cause.**

---

# 15. Second important remaining problem — retry ownership may be ambiguous

Canonical production construction currently uses:

```ts
new OpenAI({ apiKey })
```

without an explicit SDK retry setting.

The adapter itself also has an explicit retry loop:

```text
MAX_RETRIES = 3
```

for at least 429 and >=500 classes.

This creates a potential layered-retry ambiguity:

```text
OpenAI SDK retry behavior
+
CodexAdapter retry behavior
```

The exact behavior must be verified against the installed `openai` package version.

If the SDK retries internally, then:

```text
adapter retry evidence count = 0
```

does NOT necessarily prove:

```text
exactly one underlying HTTP request
```

Recommended invariant for auditability:

> exactly one retry owner.

Likely implementation direction, if confirmed against installed SDK behavior:

```ts
new OpenAI({
  apiKey,
  maxRetries: 0,
})
```

while preserving explicit adapter-owned retry policy and evidence.

Do not implement this from this document alone without checking the local dependency/version and existing tests.

---

# 16. Third important problem — smoke harness discipline

The live harness must never be debugged by repeatedly executing it against the real provider.

Before the next live call:

1. build the harness;
2. compile/typecheck it;
3. inspect it statically;
4. verify DB schema/setup;
5. verify cleanup;
6. verify no private state access;
7. verify exact command;
8. only then authorize ONE live execution.

If that execution fails:

> stop, collect evidence, repair offline, and require a new Owner live authorization.

Do not rerun casually.

---

# 17. Do NOT change the provider model yet

Do not assume `gpt-4o` is the problem.

R1 successfully obtained a real OpenAI response and reported:

```text
gpt-4o-2024-08-06
```

R2 failed before a successful provider response, but the exact error was not preserved.

Therefore there is currently **no evidence-backed basis** to change the model simply to make the smoke pass.

First improve diagnostic evidence.

---

# 18. Local candidate is uncommitted — preservation procedure

This is critical.

Before Claude Code or Codex changes anything, run locally:

```bash
git fetch origin

git rev-parse origin/main
git branch --show-current
git status --short --untracked-files=all

git diff --name-status origin/main
git diff --stat origin/main

git diff origin/main > /tmp/f001-local-before-next-agent.patch
```

Expected canonical remote main:

```text
590a9b5830096fee36a5395543937caba624fa64
```

Expected local branch:

```text
fix/f001-real-worker-runtime
```

Do NOT:

```text
git reset --hard
git clean -fd
git checkout .
git restore .
git rebase
git merge
```

until the current local diff has been fully inspected and preserved.

The next agent must treat the local worktree as evidence.

---

# 19. Files known to have been part of the F-001 candidate

The earlier local F-001 candidate reported modifications in this set:

```text
apps/worker/src/index.ts
apps/worker/src/worker.ts
apps/worker/test/worker.test.ts

packages/workflow/src/minimal-workflow-engine.ts

tests/e2e/p12-r57-repair.spec.ts
tests/e2e/p12-r60-closure.spec.ts

tests/integration/work-item-dispatch.spec.ts
tests/integration/worker-evidence-identity.spec.ts
tests/integration/f001-real-worker-runtime.spec.ts

tests/regression/no-mock-in-production.spec.ts
```

The async lifecycle repair also touched at least:

```text
apps/worker/src/worker.ts
packages/workflow/src/minimal-workflow-engine.ts
tests/integration/f001-real-worker-runtime.spec.ts
```

Do not assume this list is complete. Use `git diff --name-status origin/main` as the authority for the current local checkout.

---

# 20. Debug residue to reject

During Antigravity investigation, temporary debug strings appeared and were reportedly removed.

Verify none remain:

```text
POLLING LOOP
EXITED POLLING LOOP
ENGINE RECEIVED SECRETS
WORKER CALLING ENGINE
EXECUTING CODEX ADAPTER
CODEX ADAPTER CAUGHT ERROR
INCREMENTED CALLCOUNT
INTENTIONAL ERROR TO TRACE
REFS:
```

Run a recursive grep before final validation.

---

# 21. Immediate next forensic task for Claude Code / Codex

The next agents should NOT begin by making another live OpenAI call.

They should first independently answer:

## A. Exact local state

- What is the exact local diff against `origin/main`?
- Does it match the intended F-001 candidate?
- Are there accidental debug/test artifacts?
- Are all current files buildable from clean local dependencies?

## B. Exact R2 failure visibility gap

Audit `CodexAdapter` for every failure class:

- 400
- 401
- 403
- 404
- 409
- 422
- 429
- >=500
- connection/no-response error
- timeout
- abort/cancel

For every class determine:

- retry?
- terminal status?
- evidence emitted?
- request ID retained?
- provider code/type retained?
- any raw unsafe error persisted?
- any secret risk?

## C. Retry ownership

Inspect:

- installed `openai` package version;
- SDK retry defaults for that version;
- current construction options;
- adapter retry loop.

Determine whether hidden transport retries can occur beneath adapter evidence.

## D. Safe diagnostic contract

Design the smallest repair that preserves safe provider diagnostics without storing raw provider errors.

Useful safe fields may include:

```text
provider=openai
adapter=codex-adapter
httpStatus
sdkErrorClass
providerErrorCode
providerErrorType
requestId
classification
```

Do NOT persist:

```text
API key
Authorization header
request headers
response headers
raw body
raw error object
stack trace
prompt content
environment variables
```

## E. Deterministic offline test matrix

Use injected fake OpenAI clients.

At minimum test:

```text
success
400
401
403
404
422
429
500
connection error
```

For each verify:

- final adapter status;
- retry count;
- evidence classification;
- request ID handling;
- no secret leakage.

For retry cases verify fake `create()` call count.

---

# 22. Recommended repair objective

Unless the independent forensic inspection finds a different root cause, the expected bounded repair is:

## 22.1 Add sanitized provider failure evidence

Examples:

```text
provider_bad_request
provider_authentication_error
provider_permission_denied
provider_not_found
provider_unprocessable_entity
provider_rate_limited
provider_server_error
provider_connection_error
provider_timeout
provider_unknown_error
```

The implementation should use existing evidence contracts where possible and avoid redesigning the entire persistence model.

## 22.2 Make retry ownership explicit

If the installed SDK confirms automatic retries by default, explicitly disable them at the SDK client layer and let `CodexAdapter` remain the sole retry authority.

Then every adapter retry can be correlated with durable retry evidence.

## 22.3 Preserve all existing F-001 invariants

Do not regress:

- production MockAgent unreachable;
- real CodexAdapter path;
- GovernedToolGateway;
- ActionClassifyingPolicyEngine;
- per-execution runtime composition;
- project/workItem/attempt binding;
- provider-neutral workflow engine;
- async settlement loop;
- bounded timeout;
- timeout → UNKNOWN / RECOVERY_REQUIRED;
- `secretRefs` default [];
- Worker Codex `secretRefs=['OPENAI_API_KEY']`;
- OutputRedactor;
- no secret persistence;
- F-011;
- F-014;
- F-015;
- F-016.

---

# 23. Validation commands required after the offline repair

Run on FINAL bytes:

```bash
pnpm lint

pnpm typecheck

pnpm build

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orchestrator pnpm test

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orchestrator pnpm test:restart:postgres

pnpm arch:check

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orchestrator pnpm v1:gate

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orchestrator pnpm qualification
```

Required:

```text
QUALIFICATION_EXIT_CODE=0
```

Do not infer success from a partial or background run.

Wait for natural termination.

---

# 24. Live R3 must be a separate Owner gate

Only after:

- local diff is understood;
- provider diagnostic evidence is repaired;
- retry ownership is proven;
- deterministic offline tests pass;
- full qualification exits 0;

may an agent request:

```text
READY_FOR_OWNER_CONTROLLED_LIVE_RESMOKE_R3_AUTHORIZATION
```

R3 must be:

- one prepared harness;
- one WorkItem;
- one Attempt;
- one AgentRun;
- one shell harness invocation;
- local disposable DB;
- no private adapter internals;
- no iterative live debugging;
- no source mutation during smoke.

If provider failure occurs again, the newly added sanitized evidence must make the cause diagnosable offline.

---

# 25. Credential handling

The Owner temporarily exposed `OPENAI_API_KEY` to the Antigravity process through the macOS launch environment.

For future use:

- never paste the key into task text;
- never print it;
- never hash it;
- never inspect substrings or length;
- never write it to `.env`;
- never write it to `.env.smoke`;
- never add it to shell profile;
- never commit it.

Presence check only:

```bash
if [ -n "$OPENAI_API_KEY" ]; then
  echo "OPENAI_API_KEY_CONFIGURED=YES"
else
  echo "OPENAI_API_KEY_CONFIGURED=NO"
fi
```

After live testing, remove temporary launch/session exposure:

```bash
launchctl unsetenv OPENAI_API_KEY
unset OPENAI_API_KEY
```

---

# 26. What is proven vs what is not

## Proven or strongly evidenced

- Canonical remote main remains `590a9b...` at handover.
- Remote main still predates F-001 local candidate.
- A local F-001 candidate exists.
- Production mock removal / real Codex composition was implemented locally according to repeated tests.
- R1 reached a real OpenAI response.
- R1 exposed the async RUNNING settlement bug.
- The async lifecycle repair was implemented locally.
- Negative control old=FAIL / new=PASS was reported.
- Final deterministic gate reported 455 tests / 0 failures / 0 skipped.
- R2 reached `CodexAdapter`, created an AgentRun, then ended FAILED / REPAIR_REQUIRED.
- R2 did not produce sufficient provider failure diagnostics.
- R2 Antigravity transcript contains multiple harness invocations.
- No F-001 commit, push, PR, merge is currently authorized/completed.

## NOT proven

- The exact R2 provider error class.
- That R2 made exactly one underlying OpenAI HTTP request.
- That Antigravity's `live harness invocations: 1` report is accurate.
- That the provider model is the problem.
- That API key validity/billing/permissions caused R2.
- That F-001 is closed.
- That the local candidate is safe to commit without another independent inspection.

---

# 27. Strong instruction to the next agent

Do not start from the assumption that the previous agent was right or wrong.

Start from evidence.

Order:

```text
PRESERVE LOCAL WORKTREE
→ INSPECT EXACT DIFF
→ REPRODUCE DETERMINISTICLY WITHOUT NETWORK
→ AUDIT PROVIDER ERROR PATH
→ AUDIT RETRY OWNERSHIP
→ REPAIR ONLY PROVEN GAPS
→ TEST FAILURE MATRIX
→ FULL QUALIFICATION
→ INDEPENDENT REVIEW
→ REQUEST OWNER LIVE R3 AUTHORITY
```

Do not use a live provider to discover bugs that can be discovered offline.

---

# 28. Suggested independent-agent split

To reduce another multi-day loop:

## Claude Code — forensic implementation reviewer

Primary mission:

- inspect exact local diff;
- identify implementation defects;
- reason through Worker/Engine/Codex lifecycle;
- audit error semantics and retry ownership;
- propose minimal patch;
- run deterministic local tests.

## OpenAI Codex — independent verification / adversarial pass

Primary mission:

- independently inspect same local diff;
- challenge Claude's root-cause analysis;
- search for hidden lifecycle, retry, evidence, or secret-leak edge cases;
- verify deterministic tests actually fail old behavior;
- verify no test is self-fulfilling;
- verify final patch against F-001 invariants.

Then reconcile outputs before any live R3.

---

# 29. Current final status

```text
F-001 = OPEN

LOCAL IMPLEMENTATION:
present, uncommitted

ASYNC LIFECYCLE BUG:
found and locally repaired

DETERMINISTIC VALIDATION:
reported green after repair

LIVE R1:
real provider response obtained
but lifecycle incorrectly failed

LIVE R2:
CodexAdapter reached
AgentRun created
no successful provider response
FAILED / REPAIR_REQUIRED
exact provider cause lost

CURRENT PRIMARY BLOCKERS:
1. insufficient sanitized provider error diagnostics
2. possible ambiguous retry ownership
3. live smoke harness discipline / evidence trust
4. independent inspection of local uncommitted candidate

NEXT ALLOWED ACTION:
offline forensic inspection and bounded repair

NEXT LIVE ACTION:
NOT AUTHORIZED until deterministic repair + qualification + Owner gate
```

---

# 30. Stop condition for this handover

This handover is informational and investigative.

It does NOT authorize:

- commit;
- push;
- PR;
- merge;
- deploy;
- production mutation;
- live OpenAI execution.

The next agent should stop at:

```text
READY_FOR_OWNER_CONTROLLED_LIVE_RESMOKE_R3_AUTHORIZATION
```

only after the offline forensic repair and full qualification are independently green.
