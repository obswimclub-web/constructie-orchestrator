import { describe, expect, it } from 'vitest';
import { ActionClassifier } from '@co/policy';
import type { ActionRequest } from '@co/policy';
import { randomUUID } from 'node:crypto';

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

const classifier = new ActionClassifier();

describe('ActionClassifier — Synterra synthetic qualification cases', () => {
  // ── Case 1: prisma db pull ────────────────────────────────────────────────
  it('classifies prisma db pull as DATABASE_READ + SCHEMA_SOURCE_MUTATION', () => {
    const classes = classifier.classify(req({ command: 'prisma db pull', tool: 'shell' }));
    expect(classes).toContain('DATABASE_READ');
    expect(classes).toContain('SCHEMA_SOURCE_MUTATION');
    expect(classes).not.toContain('READ_ONLY');
  });

  // ── Case 2 & 3: .env file access ─────────────────────────────────────────
  it('classifies cat .env as SECRET_READ', () => {
    const classes = classifier.classify(req({ command: 'cat .env', tool: 'shell' }));
    expect(classes).toContain('SECRET_READ');
  });

  it('classifies grep DATABASE_URL .env as SECRET_READ', () => {
    const classes = classifier.classify(req({
      command: 'grep DATABASE_URL .env',
      tool: 'shell',
    }));
    expect(classes).toContain('SECRET_READ');
  });

  it('classifies cat .env.production as SECRET_READ', () => {
    const classes = classifier.classify(req({ command: 'cat .env.production', tool: 'shell' }));
    expect(classes).toContain('SECRET_READ');
  });

  // ── Case 5: POST /auth/login ──────────────────────────────────────────────
  it('classifies POST /auth/login as AUTH_SESSION_CREATION + CREDENTIAL_USE', () => {
    const classes = classifier.classify(req({
      tool: 'http',
      operation: 'http.post',
      httpMethod: 'POST',
      resource: 'https://api.example.com/auth/login',
      environment: 'PRODUCTION',
    }));
    expect(classes).toContain('AUTH_SESSION_CREATION');
    expect(classes).toContain('CREDENTIAL_USE');
    expect(classes).toContain('PRODUCTION_MUTATION');
  });

  // ── HTTP GET is read-only ─────────────────────────────────────────────────
  it('classifies GET /health/live as PRODUCTION_READ (case 12)', () => {
    const classes = classifier.classify(req({
      tool: 'http',
      operation: 'http.get',
      httpMethod: 'GET',
      resource: 'https://api.example.com/health/live',
      environment: 'PRODUCTION',
    }));
    expect(classes).toContain('PRODUCTION_READ');
    expect(classes).not.toContain('PRODUCTION_MUTATION');
  });

  it('classifies GET /branches as PRODUCTION_READ (case 13)', () => {
    const classes = classifier.classify(req({
      tool: 'http',
      operation: 'http.get',
      httpMethod: 'GET',
      resource: 'https://api.example.com/branches',
      environment: 'PRODUCTION',
    }));
    expect(classes).toContain('PRODUCTION_READ');
  });

  // ── Git staging ───────────────────────────────────────────────────────────
  it('classifies exact git add of single file as GIT_STAGE (case 10)', () => {
    const classes = classifier.classify(req({
      tool: 'git',
      operation: 'git.add',
      gitOperation: 'add',
      args: ['approved/file.ts'],
      resource: 'git://local',
    }));
    expect(classes).toContain('GIT_STAGE');
    expect(classes).not.toContain('UNKNOWN');
  });

  it('classifies git add . as GIT_STAGE + UNKNOWN (broad staging — globally denied)', () => {
    const classes = classifier.classify(req({
      tool: 'git',
      operation: 'git.add',
      gitOperation: 'add',
      args: ['.'],
      resource: 'git://local',
    }));
    expect(classes).toContain('GIT_STAGE');
    expect(classes).toContain('UNKNOWN'); // forces REQUIRE_APPROVAL
  });

  it('classifies git commit as GIT_COMMIT (case 7)', () => {
    const classes = classifier.classify(req({
      tool: 'git',
      operation: 'git.commit',
      gitOperation: 'commit',
      resource: 'git://local',
    }));
    expect(classes).toContain('GIT_COMMIT');
  });

  it('classifies git push as GIT_PUSH (case 8)', () => {
    const classes = classifier.classify(req({
      tool: 'git',
      operation: 'git.push',
      gitOperation: 'push',
      resource: 'git://local',
    }));
    expect(classes).toContain('GIT_PUSH');
  });

  it('classifies git push --force as GIT_PUSH + GIT_DESTRUCTIVE', () => {
    const classes = classifier.classify(req({
      tool: 'git',
      operation: 'git.push',
      gitOperation: 'push',
      args: ['--force'],
      resource: 'git://local',
    }));
    expect(classes).toContain('GIT_PUSH');
    expect(classes).toContain('GIT_DESTRUCTIVE');
  });

  // ── Deployment ────────────────────────────────────────────────────────────
  it('classifies railway up as DEPLOYMENT (case 9)', () => {
    const classes = classifier.classify(req({ command: 'railway up', tool: 'shell' }));
    expect(classes).toContain('DEPLOYMENT');
  });

  it('classifies railway redeploy as DEPLOYMENT', () => {
    const classes = classifier.classify(req({ command: 'railway redeploy', tool: 'shell' }));
    expect(classes).toContain('DEPLOYMENT');
  });

  // ── prisma migrate ────────────────────────────────────────────────────────
  it('classifies prisma migrate dev as DATABASE_MUTATION + SCHEMA_MUTATION + DESTRUCTIVE', () => {
    const classes = classifier.classify(req({ command: 'prisma migrate dev', tool: 'shell' }));
    expect(classes).toContain('DATABASE_MUTATION');
    expect(classes).toContain('SCHEMA_MUTATION');
    expect(classes).toContain('DESTRUCTIVE');
  });

  // ── Secret variable echo ──────────────────────────────────────────────────
  it('classifies printenv as SECRET_READ', () => {
    const classes = classifier.classify(req({ command: 'printenv', tool: 'shell' }));
    expect(classes).toContain('SECRET_READ');
  });

  // ── Source edit ───────────────────────────────────────────────────────────
  it('classifies filesystem write to .ts file as SOURCE_MUTATION', () => {
    const classes = classifier.classify(req({
      tool: 'sandbox-filesystem',
      operation: 'filesystem.write',
      resource: 'packages/policy/src/engine.ts',
    }));
    expect(classes).toContain('SOURCE_MUTATION');
    expect(classes).toContain('LOCAL_MUTATION');
  });
});
