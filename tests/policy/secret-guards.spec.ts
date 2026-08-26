import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuthCredentialScriptGuard,
  SecretFileGuard,
  SecretLiteralGuard,
  SecretOutputGuard,
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

// ── SecretFileGuard ───────────────────────────────────────────────────────────
describe('SecretFileGuard', () => {
  const guard = new SecretFileGuard();

  it('triggers on cat .env (case 2)', () => {
    const result = guard.check(req({ command: 'cat .env' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_FILE_READ');
  });

  it('triggers on grep DATABASE_URL .env (case 3)', () => {
    const result = guard.check(req({ command: 'grep DATABASE_URL .env' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_FILE_READ');
  });

  it('triggers on grep SECRET .env.production', () => {
    const result = guard.check(req({ command: 'grep SECRET .env.production' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_FILE_READ');
  });

  it('triggers on awk extraction from .env', () => {
    const result = guard.check(req({ command: "awk -F= '{print $2}' .env" }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_FILE_READ');
  });

  it('does NOT trigger on cat package.json', () => {
    const result = guard.check(req({ command: 'cat package.json' }));
    expect(result).toBeNull();
  });

  it('does NOT trigger on cat README.md', () => {
    const result = guard.check(req({ command: 'cat README.md' }));
    expect(result).toBeNull();
  });
});

// ── SecretOutputGuard ─────────────────────────────────────────────────────────
describe('SecretOutputGuard', () => {
  const guard = new SecretOutputGuard();

  it('triggers on printenv', () => {
    const result = guard.check(req({ command: 'printenv' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_OUTPUT_ENV_DUMP');
  });

  it('triggers on env', () => {
    const result = guard.check(req({ command: 'env' }));
    expect(result).not.toBeNull();
  });

  it('triggers on echo $DATABASE_URL', () => {
    const result = guard.check(req({ command: 'echo $DATABASE_URL' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_OUTPUT_ECHO');
  });

  it('triggers on railway variables', () => {
    const result = guard.check(req({ command: 'railway variables' }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_OUTPUT_RAILWAY_VARS');
  });

  it('does NOT trigger on echo hello world', () => {
    const result = guard.check(req({ command: 'echo hello world' }));
    expect(result).toBeNull();
  });
});

// ── SecretLiteralGuard ────────────────────────────────────────────────────────
describe('SecretLiteralGuard', () => {
  const guard = new SecretLiteralGuard();

  it('triggers on postgres connection string with credentials', () => {
    const result = guard.check(req({
      command: 'psql postgres://admin:mypassword123@db.prod.example.com/app',
    }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_LITERAL_DETECTED');
  });

  it('triggers when generated content contains password literal (case 4)', () => {
    const result = guard.check(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      generatedContent: `
        const response = await fetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'admin@example.com', password: 'super_secret_password_123' })
        });
      `,
    }));
    expect(result).not.toBeNull();
    expect(result!.ruleCode).toBe('SECRET_LITERAL_DETECTED');
  });

  it('triggers on Authorization Bearer literal in command', () => {
    const result = guard.check(req({
      command: 'curl -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.def" https://api.example.com',
    }));
    expect(result).not.toBeNull();
  });

  it('does NOT trigger on env variable reference (safe pattern)', () => {
    const result = guard.check(req({
      command: 'curl -H "Authorization: Bearer $JWT_TOKEN" https://api.example.com',
    }));
    // $JWT_TOKEN is a variable reference, not a literal — should not trigger
    expect(result).toBeNull();
  });

  it('triggers on private key PEM in generated content', () => {
    const result = guard.check(req({
      generatedContent: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
    }));
    expect(result).not.toBeNull();
  });
});

// ── AuthCredentialScriptGuard ─────────────────────────────────────────────────
describe('AuthCredentialScriptGuard (Synterra incident pattern)', () => {
  const guard = new AuthCredentialScriptGuard();

  it('triggers on generated JS with embedded production email+password (case 4 / Synterra)', () => {
    const result = guard.check(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      generatedContent: `
        import fetch from 'node-fetch';
        const email = 'admin@company.com';
        const password = 'Pr0duct10nP@ssw0rd!';
        const resp = await fetch('https://app.synterra.io/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
      `,
    }));
    expect(result).not.toBeNull();
    expect(result!.guardName).toBe('AuthCredentialScriptGuard');
    expect(result!.ruleCode).toBe('AUTH_CREDENTIAL_IN_GENERATED_CONTENT');
  });

  it('does NOT trigger on generated file with no credentials', () => {
    const result = guard.check(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      generatedContent: `
        export function add(a: number, b: number): number { return a + b; }
      `,
    }));
    expect(result).toBeNull();
  });

  it('does NOT trigger on generated file using env variable references', () => {
    const result = guard.check(req({
      tool: 'filesystem',
      operation: 'filesystem.write',
      generatedContent: `
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
      `,
    }));
    expect(result).toBeNull();
  });
});
