import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ActionClassifyingPolicyEngine,
  InMemoryExecutionAuditLedger,
  OwnerEventProcessor,
  TrustedOwnerAuthorityIssuer,
} from '@co/policy';
import type { ActionRequest, ReadOnlyExecutionContext } from '@co/policy';

const TASK_ID = 'task-engine-test';
const OWNER_REF = 'owner:test';

function issuer() {
  return new TrustedOwnerAuthorityIssuer(OWNER_REF, TASK_ID);
}

function makeContext(options: {
  initialGate: ActionRequest['environment'] extends string ? string : never;
  environment?: string;
  tokens?: string[];
  approvedFiles?: string[];
} & { initialGate: Parameters<typeof OwnerEventProcessor>[0]['initialGate'] }): ReadOnlyExecutionContext {
  const processor = new OwnerEventProcessor({
    taskId: TASK_ID,
    initialGate: options.initialGate,
    environment: (options.environment as 'LOCAL' | 'TEST' | 'STAGING' | 'PRODUCTION') ?? 'LOCAL',
  });
  const iss = issuer();
  if (options.tokens) {
    for (const token of options.tokens as Parameters<ReturnType<typeof issuer>['issueAuthorityEvent']>[0]['authorityType'][]) {
      const evt = iss.issueAuthorityEvent({ authorityType: token });
      processor.applyOwnerAuthorityEvent(evt);
    }
  }
  if (options.approvedFiles) {
    const scopeEvt = iss.issueApprovedScopeEvent({ approvedFiles: options.approvedFiles });
    processor.setApprovedScopeFromPlan(scopeEvt);
  }
  return processor.readOnlyView;
}

function req(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: randomUUID(),
    taskId: TASK_ID,
    agentId: 'agent-1',
    provider: 'codex',
    tool: 'shell',
    operation: 'shell.exec',
    resource: 'shell://local',
    environment: 'LOCAL',
    parameters: {},
    authorityContextRef: 'authority://test',
    correlationId: 'corr-1',
    ...overrides,
  };
}

// ─── 14 Synthetic Qualification Cases from Synterra incidents ─────────────────

describe('ActionClassifyingPolicyEngine — 14 Synterra synthetic qualification cases', () => {
  // ── CASE 1: prisma db pull in PRODUCTION_VALIDATION_READ_ONLY ────────────
  it('CASE 1 — DENY: prisma db pull in PRODUCTION_VALIDATION_READ_ONLY gate', async () => {
    const ctx = makeContext({ initialGate: 'PRODUCTION_VALIDATION_READ_ONLY', environment: 'PRODUCTION' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({ command: 'prisma db pull', tool: 'shell' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toMatch(/SCHEMA_SOURCE_MUTATION|DATABASE_READ/);
  });

  // ── CASE 2: cat .env in read-only gate ───────────────────────────────────
  it('CASE 2 — DENY: cat .env in PRODUCTION_VALIDATION_READ_ONLY gate', async () => {
    const ctx = makeContext({ initialGate: 'PRODUCTION_VALIDATION_READ_ONLY', environment: 'PRODUCTION' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({ command: 'cat .env' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('SECRET_FILE_READ');
  });

  // ── CASE 3: grep DATABASE_URL .env ───────────────────────────────────────
  it('CASE 3 — DENY: grep DATABASE_URL .env (any gate)', async () => {
    const ctx = makeContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({ command: 'grep DATABASE_URL .env' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('SECRET_FILE_READ');
  });

  // ── CASE 4: generated script with password literal ────────────────────────
  it('CASE 4 — DENY: generated script containing credential literal', async () => {
    const ctx = makeContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      resource: 'packages/policy/src/test.ts',
      generatedContent: 'const password = "super_secret_password_123";',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('SECRET_LITERAL_DETECTED');
  });

  // ── CASE 5: POST /auth/login in read-only gate ────────────────────────────
  it('CASE 5 — DENY: POST /auth/login in PRODUCTION_VALIDATION gate', async () => {
    const ctx = makeContext({ initialGate: 'PRODUCTION_VALIDATION', environment: 'PRODUCTION' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'http',
      operation: 'http.post',
      httpMethod: 'POST',
      resource: 'https://api.example.com/auth/login',
      environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('DENY');
  });

  // ── CASE 6: git commit without token in COMMIT gate ───────────────────────
  it('CASE 6 — DENY: git commit without OWNER_COMMIT_APPROVED', async () => {
    const ctx = makeContext({ initialGate: 'COMMIT', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.commit', gitOperation: 'commit', resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_COMMIT_APPROVED');
  });

  // ── CASE 7: git push without token in PUSH gate ───────────────────────────
  it('CASE 7 — DENY: git push without OWNER_PUSH_APPROVED', async () => {
    const ctx = makeContext({ initialGate: 'PUSH', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.push', gitOperation: 'push', resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_PUSH_APPROVED');
  });

  // ── CASE 8: source edit without token in IMPLEMENTATION gate ─────────────
  it('CASE 8 — DENY: source edit in IMPLEMENTATION without OWNER_IMPLEMENTATION_APPROVED', async () => {
    const ctx = makeContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'sandbox-filesystem', operation: 'filesystem.write',
      resource: 'packages/policy/src/types.ts',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_IMPLEMENTATION_APPROVED');
  });

  // ── CASE 9: git push in COMMIT gate (wrong gate) ──────────────────────────
  it('CASE 9 — DENY: git push in COMMIT gate (requires PUSH gate)', async () => {
    const ctx = makeContext({
      initialGate: 'COMMIT', environment: 'LOCAL',
      tokens: ['OWNER_COMMIT_APPROVED'],
    });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.push', gitOperation: 'push', resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
  });

  // ── CASE 10: git add of approved file in COMMIT gate — ALLOW ─────────────
  it('CASE 10 — ALLOW: git add of approved file in COMMIT gate with token', async () => {
    const ctx = makeContext({
      initialGate: 'COMMIT', environment: 'LOCAL',
      tokens: ['OWNER_COMMIT_APPROVED'],
      approvedFiles: ['approved/file.ts'],
    });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.add', gitOperation: 'add',
      args: ['approved/file.ts'], resource: 'git://local',
      requestedFilePaths: ['approved/file.ts'],
    }));
    expect(decision.decision).toBe('ALLOW');
    expect(decision.grantedByAuthority).toBe('OWNER_COMMIT_APPROVED');
  });

  // ── CASE 11: git add of unapproved file in COMMIT gate — DENY ────────────
  it('CASE 11 — DENY: git add of unapproved file in COMMIT gate', async () => {
    const ctx = makeContext({
      initialGate: 'COMMIT', environment: 'LOCAL',
      tokens: ['OWNER_COMMIT_APPROVED'],
      approvedFiles: ['approved/file.ts'],
    });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.add', gitOperation: 'add',
      args: ['unrelated/file.ts'], resource: 'git://local',
      requestedFilePaths: ['unrelated/file.ts'],
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('FILE_NOT_IN_APPROVED_SCOPE');
  });

  // ── CASE 12: GET /health/live in PRODUCTION_VALIDATION — ALLOW ───────────
  it('CASE 12 — ALLOW: GET /health/live in PRODUCTION_VALIDATION gate', async () => {
    const ctx = makeContext({ initialGate: 'PRODUCTION_VALIDATION', environment: 'PRODUCTION' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'http', operation: 'http.get', httpMethod: 'GET',
      resource: 'https://api.example.com/health/live', environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('ALLOW');
  });

  // ── CASE 13: GET /branches in PRODUCTION_VALIDATION — ALLOW ──────────────
  it('CASE 13 — ALLOW: GET /branches in PRODUCTION_VALIDATION gate', async () => {
    const ctx = makeContext({ initialGate: 'PRODUCTION_VALIDATION', environment: 'PRODUCTION' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'http', operation: 'http.get', httpMethod: 'GET',
      resource: 'https://api.example.com/branches', environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('ALLOW');
  });

  // ── CASE 14: CRITICAL — model declares STOP then proposes git push ────────
  it('CASE 14 — CRITICAL: git push is DENIED independently of model text', async () => {
    const ctx = makeContext({ initialGate: 'PUSH', environment: 'LOCAL' });
    // NO OWNER_PUSH_APPROVED token granted — simulating the defect scenario
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.push', gitOperation: 'push',
      args: ['origin', 'main'], resource: 'git://origin/main',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_PUSH_APPROVED');
    expect(decision.decision).not.toBe('ALLOW');
  });
});

// ── Additional gate × class coverage ────────────────────────────────────────
describe('ActionClassifyingPolicyEngine — additional gate rules', () => {
  it('AUDIT gate allows read-only but denies any mutation', async () => {
    const ctx = makeContext({ initialGate: 'AUDIT', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);

    const readResult = await engine.evaluate(req({
      tool: 'sandbox-filesystem', operation: 'filesystem.read',
      resource: 'packages/policy/src/index.ts',
    }));
    expect(readResult.decision).toBe('ALLOW');

    const writeResult = await engine.evaluate(req({
      tool: 'sandbox-filesystem', operation: 'filesystem.write',
      resource: 'packages/policy/src/index.ts',
    }));
    expect(writeResult.decision).toBe('DENY');
  });

  it('git commit in IMPLEMENTATION gate is denied (not yet in COMMIT gate)', async () => {
    const ctx = makeContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.commit', gitOperation: 'commit', resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
  });

  it('git push in COMMIT gate is denied (push requires PUSH gate)', async () => {
    const ctx = makeContext({
      initialGate: 'COMMIT', environment: 'LOCAL',
      tokens: ['OWNER_COMMIT_APPROVED'],
    });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'git', operation: 'git.push', gitOperation: 'push', resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
  });

  it('fail-closed: unknown tool returns REQUIRE_APPROVAL', async () => {
    const ctx = makeContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    const decision = await engine.evaluate(req({
      tool: 'some-exotic-tool-xyz', operation: 'exotic.explode', resource: 'unknown://resource',
    }));
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
  });

  it('ALLOW sets evaluatorKind on engine instance', () => {
    const ctx = makeContext({ initialGate: 'AUDIT', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(ctx);
    expect(engine.evaluatorKind).toBe('ACTION_POLICY_EVALUATOR');
  });
});

// ── Audit ledger integration ──────────────────────────────────────────────────
describe('InMemoryExecutionAuditLedger', () => {
  it('denied entries show executionResult NOT_EXECUTED', () => {
    const ledger = new InMemoryExecutionAuditLedger();
    const actionId = randomUUID();
    ledger.recordProposed({
      actionId,
      proposedAt: new Date(),
      request: req({ actionId }),
      classification: ['SECRET_READ'],
      decision: {
        actionId,
        decision: 'DENY',
        policyRule: 'SECRET_FILE_READ',
        currentGate: 'PRODUCTION_VALIDATION_READ_ONLY',
        triggeringClasses: ['SECRET_READ'],
        allClasses: ['SECRET_READ'],
        reason: 'test denial',
      },
    });
    ledger.recordExecuted(actionId, 'NOT_EXECUTED');

    const denied = ledger.denied();
    expect(denied).toHaveLength(1);
    expect(denied[0]!.executionResult).toBe('NOT_EXECUTED');
  });
});
