import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_EXECUTION_REQUEST_SCHEMA_VERSION, type ToolExecutionRequest } from '@co/contracts';
import {
  GovernedToolGateway,
  MockToolAdapter,
  SandboxFilesystemAdapter,
  SandboxPathViolationError,
  StaticToolPolicy,
} from '@co/tools';

function request(overrides: Partial<ToolExecutionRequest> = {}): ToolExecutionRequest {
  return {
    schemaVersion: TOOL_EXECUTION_REQUEST_SCHEMA_VERSION,
    requestId: 'req-1',
    projectId: 'project-1',
    actorRef: 'agent-1',
    workItemRef: 'work-1',
    workPackageRef: 'wp-1',
    toolId: 'mock',
    operationId: 'mock.execute',
    targetResource: 'sandbox://fixture',
    environment: 'test',
    parameters: {},
    authorityContextRef: 'authority-1',
    idempotencyKey: 'idem-1',
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('GovernedToolGateway', () => {
  it('denies an operation before the adapter executes', async () => {
    const gateway = new GovernedToolGateway(new StaticToolPolicy({ allowedOperations: [] }), [new MockToolAdapter('SUCCESS')]);
    const result = await gateway.execute(request());
    expect(result.status).toBe('DENIED');
    expect(result.sideEffects).toEqual([]);
  });

  it('executes an allowed operation through the registered adapter', async () => {
    const gateway = new GovernedToolGateway(new StaticToolPolicy({ allowedOperations: ['mock.execute'] }), [new MockToolAdapter('SUCCESS')]);
    const result = await gateway.execute(request());
    expect(result.status).toBe('SUCCEEDED');
  });

  it('marks ambiguous mock effects as reconciliation-required', async () => {
    const gateway = new GovernedToolGateway(new StaticToolPolicy({ allowedOperations: ['mock.execute'] }), [new MockToolAdapter('UNKNOWN')]);
    const result = await gateway.execute(request());
    expect(result.status).toBe('UNKNOWN');
    expect(result.reconciliationRequired).toBe(true);
  });
});

describe('SandboxFilesystemAdapter', () => {
  it('writes only inside an allowed root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'co-sandbox-'));
    const file = join(root, 'nested', 'result.txt');
    const gateway = new GovernedToolGateway(
      new StaticToolPolicy({ allowedOperations: ['filesystem.write'] }),
      [new SandboxFilesystemAdapter([root])],
    );
    const result = await gateway.execute(request({
      toolId: 'sandbox-filesystem',
      operationId: 'filesystem.write',
      parameters: { path: file, content: 'ok' },
    }));
    expect(result.status).toBe('SUCCEEDED');
    expect(await readFile(file, 'utf8')).toBe('ok');
  });

  it('rejects path traversal / writes outside allowed roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'co-sandbox-'));
    const adapter = new SandboxFilesystemAdapter([root]);
    const gateway = new GovernedToolGateway(
      new StaticToolPolicy({ allowedOperations: ['filesystem.write'] }),
      [adapter],
    );
    await expect(gateway.execute(request({
      toolId: 'sandbox-filesystem',
      operationId: 'filesystem.write',
      parameters: { path: join(root, '..', 'escape.txt'), content: 'no' },
    }))).rejects.toBeInstanceOf(SandboxPathViolationError);
  });
});
