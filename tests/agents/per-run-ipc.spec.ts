import { describe, it, expect, vi } from 'vitest';
import { PerRunIpcServer } from '@co/agents';
import { OutputRedactor } from '@co/tools';
import * as net from 'net';

describe('PerRunIpcServer Behavioral', () => {
  it('correct nonce accepted, wrong nonce rejected, forged identity ignored', async () => {
    const gateway = { execute: vi.fn().mockResolvedValue({ status: 'SUCCEEDED', summary: 'ok', artifacts: [], evidenceCandidates: [], sideEffects: [], reconciliationRequired: false }) } as unknown;
    const context = { environment: 'LOCAL', workflowRunId: 'run-1', attemptId: 'attempt-1', correlationId: 'corr-1', secretRefs: [] } as unknown;
    const wp = { projectId: 'proj-1', workItemId: 'wi-1', workPackageId: 'wp-1', authorityContextRef: 'auth-1' } as unknown;

    const server = new PerRunIpcServer(context, gateway, new OutputRedactor(), wp);
    await server.start();

    // Connect with wrong nonce
    const client1 = net.createConnection(server.socketPath);
    const p1 = new Promise<string>((res) => client1.once('data', (d) => res(d.toString())));
    client1.write(JSON.stringify({ tool: 'git', operation: 'status', nonce: 'wrong', parameters: {} }) + '\n');
    const resp1 = await p1;
    expect(resp1).toContain('Unauthorized IPC connection');
    client1.destroy();

    // Connect with forged fields
    const client2 = net.createConnection(server.socketPath);
    const p2 = new Promise<string>((res) => client2.once('data', (d) => res(d.toString())));
    client2.write(JSON.stringify({
      tool: 'git', operation: 'status', nonce: server.nonce, parameters: {},
      taskId: 'forged', projectId: 'forged', environment: 'PRODUCTION'
    }) + '\n');
    const resp2 = await p2;
    expect(resp2).toContain('SUCCEEDED');
    client2.destroy();

    await server.stop();

    // Verify canonical context was used
    expect(gateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      workItemRef: 'wi-1',
      workPackageRef: 'wp-1',
      authorityContextRef: 'auth-1',
      correlationId: 'corr-1',
      environment: 'LOCAL'
    }));
    // Verify schema-valid ToolExecutionRequest shape was built
    const req = (gateway.execute as unknown as import('@co/contracts').ToolExecutionResult).mock.calls[0][0];
    expect(req.toolId).toBe('git');
    expect(req.operationId).toBe('status');
    expect(req.targetResource).toBeTruthy();
  });
});
