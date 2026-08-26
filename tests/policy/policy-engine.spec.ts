import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ActionClassifyingPolicyEngine,
  ExecutionGateContext,
  InMemoryExecutionAuditLedger,
} from '@co/policy';
import type { ActionRequest } from '@co/policy';

function req(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: randomUUID(),
    taskId: 'task-1',
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
  let gateCtx: ExecutionGateContext;
  let engine: ActionClassifyingPolicyEngine;

  // ── CASE 1: prisma db pull in PRODUCTION_VALIDATION_READ_ONLY ────────────
  it('CASE 1 — DENY: prisma db pull in PRODUCTION_VALIDATION_READ_ONLY gate', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PRODUCTION_VALIDATION_READ_ONLY', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({ command: 'prisma db pull', tool: 'shell' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toMatch(/SCHEMA_SOURCE_MUTATION|DATABASE_READ/);
  });

  // ── CASE 2: cat .env in read-only gate ───────────────────────────────────
  it('CASE 2 — DENY: cat .env in PRODUCTION_VALIDATION_READ_ONLY gate', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PRODUCTION_VALIDATION_READ_ONLY', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({ command: 'cat .env' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('SECRET_FILE_READ');
  });

  // ── CASE 3: grep DATABASE_URL .env ───────────────────────────────────────
  it('CASE 3 — DENY: grep DATABASE_URL .env (any gate)', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({ command: 'grep DATABASE_URL .env' }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('SECRET_FILE_READ');
  });

  // ── CASE 4: generated script with password literal ────────────────────────
  it('CASE 4 — DENY: generated JS contains production password literal', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      resource: '/tmp/login-script.js',
      generatedContent: `
        const email = 'admin@company.com';
        const password = 'Prod_Secret_2024!';
        const resp = await fetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      `,
    }));
    expect(decision.decision).toBe('DENY');
    expect(['AUTH_CREDENTIAL_IN_GENERATED_CONTENT', 'SECRET_LITERAL_DETECTED']).toContain(decision.policyRule);
  });

  // ── CASE 5: POST /auth/login in READ_ONLY gate ───────────────────────────
  it('CASE 5 — DENY: POST /auth/login in PRODUCTION_VALIDATION_READ_ONLY gate', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PRODUCTION_VALIDATION_READ_ONLY', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'http',
      operation: 'http.post',
      httpMethod: 'POST',
      resource: 'https://api.example.com/auth/login',
      environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('DENY');
  });

  // ── CASE 6: source edit in OWNER_PLAN_REVIEW ─────────────────────────────
  it('CASE 6 — DENY: source edit in OWNER_PLAN_REVIEW gate', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'OWNER_PLAN_REVIEW', environment: 'LOCAL' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'sandbox-filesystem',
      operation: 'filesystem.write',
      resource: 'packages/policy/src/types.ts',
    }));
    expect(decision.decision).toBe('DENY');
  });

  // ── CASE 7: git commit with no OWNER_COMMIT_APPROVED token ───────────────
  it('CASE 7 — DENY: git commit without OWNER_COMMIT_APPROVED token', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'COMMIT', environment: 'LOCAL' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.commit',
      gitOperation: 'commit',
      resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('OWNER_COMMIT_APPROVED_REQUIRED');
    expect(decision.requiredAuthority).toBe('OWNER_COMMIT_APPROVED');
  });

  // ── CASE 8: git push with no OWNER_PUSH_APPROVED token ───────────────────
  it('CASE 8 — DENY: git push without OWNER_PUSH_APPROVED token', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PUSH', environment: 'LOCAL' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.push',
      gitOperation: 'push',
      resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('OWNER_PUSH_APPROVED_REQUIRED');
    expect(decision.requiredAuthority).toBe('OWNER_PUSH_APPROVED');
  });

  // ── CASE 9: manual railway deploy without OWNER_DEPLOY_APPROVED ──────────
  it('CASE 9 — DENY: railway up without OWNER_DEPLOY_APPROVED token', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'DEPLOY', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      command: 'railway up',
      environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_DEPLOY_APPROVED');
  });

  // ── CASE 10: git add of approved file in COMMIT gate — ALLOW ─────────────
  it('CASE 10 — ALLOW: git add of approved file in COMMIT gate with token', async () => {
    gateCtx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      initialTokens: ['OWNER_COMMIT_APPROVED'],
      approvedFileScope: ['approved/file.ts'],
    });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.add',
      gitOperation: 'add',
      args: ['approved/file.ts'],
      resource: 'git://local',
      requestedFilePaths: ['approved/file.ts'],
    }));
    expect(decision.decision).toBe('ALLOW');
  });

  // ── CASE 11: git add of unapproved file in COMMIT gate — DENY ────────────
  it('CASE 11 — DENY: git add of unapproved file in COMMIT gate', async () => {
    gateCtx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      initialTokens: ['OWNER_COMMIT_APPROVED'],
      approvedFileScope: ['approved/file.ts'],
    });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.add',
      gitOperation: 'add',
      args: ['unrelated/file.ts'],
      resource: 'git://local',
      requestedFilePaths: ['unrelated/file.ts'],
    }));
    expect(decision.decision).toBe('DENY');
    expect(decision.policyRule).toBe('FILE_NOT_IN_APPROVED_SCOPE');
  });

  // ── CASE 12: GET /health/live in PRODUCTION_VALIDATION — ALLOW ───────────
  it('CASE 12 — ALLOW: GET /health/live in PRODUCTION_VALIDATION gate', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PRODUCTION_VALIDATION', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'http',
      operation: 'http.get',
      httpMethod: 'GET',
      resource: 'https://api.example.com/health/live',
      environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('ALLOW');
  });

  // ── CASE 13: GET /branches in PRODUCTION_VALIDATION — ALLOW ──────────────
  it('CASE 13 — ALLOW: GET /branches in PRODUCTION_VALIDATION gate (no secret behavior)', async () => {
    gateCtx = new ExecutionGateContext({ initialGate: 'PRODUCTION_VALIDATION', environment: 'PRODUCTION' });
    engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'http',
      operation: 'http.get',
      httpMethod: 'GET',
      resource: 'https://api.example.com/branches',
      environment: 'PRODUCTION',
    }));
    expect(decision.decision).toBe('ALLOW');
  });

  // ── CASE 14: CRITICAL — model declares STOP then proposes git push ────────
  it('CASE 14 — CRITICAL: git push is DENIED independently of model text', async () => {
    // Simulates the scenario where the model output says "STOP — Owner approval required"
    // but the execution layer still proposes git push.
    // The engine MUST deny regardless of any model-generated prose.
    gateCtx = new ExecutionGateContext({ initialGate: 'PUSH', environment: 'LOCAL' });
    // NO OWNER_PUSH_APPROVED token granted — simulating the defect scenario
    engine = new ActionClassifyingPolicyEngine(gateCtx);

    // The model "said" it was stopping, but the execution layer submitted this anyway:
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.push',
      gitOperation: 'push',
      args: ['origin', 'main'],
      resource: 'git://origin/main',
    }));

    // STRUCTURAL ENFORCEMENT: denial is independent of model text
    expect(decision.decision).toBe('DENY');
    expect(decision.requiredAuthority).toBe('OWNER_PUSH_APPROVED');
    // Verify the denial is hard and not just advisory
    expect(decision.decision).not.toBe('ALLOW');
  });
});

// ── Additional gate × class coverage ────────────────────────────────────────
describe('ActionClassifyingPolicyEngine — additional gate rules', () => {
  it('AUDIT gate allows read-only but denies any mutation', async () => {
    const gateCtx = new ExecutionGateContext({ initialGate: 'AUDIT', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(gateCtx);

    const readResult = await engine.evaluate(req({
      tool: 'sandbox-filesystem',
      operation: 'filesystem.read',
      resource: 'packages/policy/src/index.ts',
    }));
    expect(readResult.decision).toBe('ALLOW');

    const writeResult = await engine.evaluate(req({
      tool: 'sandbox-filesystem',
      operation: 'filesystem.write',
      resource: 'packages/policy/src/index.ts',
    }));
    expect(writeResult.decision).toBe('DENY');
  });

  it('git commit in IMPLEMENTATION gate is denied (not yet in COMMIT gate)', async () => {
    const gateCtx = new ExecutionGateContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.commit',
      gitOperation: 'commit',
      resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
  });

  it('git push in COMMIT gate is denied (push requires PUSH gate)', async () => {
    const gateCtx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      initialTokens: ['OWNER_COMMIT_APPROVED'],
    });
    const engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'git',
      operation: 'git.push',
      gitOperation: 'push',
      resource: 'git://local',
    }));
    expect(decision.decision).toBe('DENY');
  });

  it('fail-closed: unknown tool returns REQUIRE_APPROVAL', async () => {
    const gateCtx = new ExecutionGateContext({ initialGate: 'IMPLEMENTATION', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(gateCtx);
    const decision = await engine.evaluate(req({
      tool: 'some-exotic-tool-xyz',
      operation: 'exotic.explode',
      resource: 'unknown://resource',
    }));
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
  });
});

// ── Audit ledger integration ──────────────────────────────────────────────────
describe('InMemoryExecutionAuditLedger', () => {
  it('records proposed and denied actions', () => {
    const ledger = new InMemoryExecutionAuditLedger();
    const gateCtx = new ExecutionGateContext({ initialGate: 'AUDIT', environment: 'LOCAL' });
    const engine = new ActionClassifyingPolicyEngine(gateCtx);

    const r = req({ command: 'cat .env' });
    engine.evaluate(r).then((decision) => {
      ledger.recordProposed({
        actionId: r.actionId,
        proposedAt: new Date(),
        request: r,
        classification: decision.allClasses,
        decision,
      });
      ledger.recordExecuted(r.actionId, 'NOT_EXECUTED');
    });
  });

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
