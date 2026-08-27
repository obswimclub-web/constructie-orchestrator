import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntigravityPythonBridge } from '../../packages/agents/src/antigravity/antigravity-python-bridge.js';
import type { AgentRuntimeContext, WorkPackage } from '@co/contracts';
import { EventEmitter } from 'events';

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

describe('AntigravityPythonBridge', () => {
  const wp: WorkPackage = {
    schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'proj-1',
    workItemId: 'item-1', completionObjectRef: 'ref', objective: 'Do nothing',
    authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx',
    requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [],
    expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [],
    dependencies: [], stopConditions: [],
  };
  const ctx: AgentRuntimeContext = { correlationId: 'c1', workflowRunId: 'r1', attemptId: 'a1', secretRefs: [] };

  let bridge: AntigravityPythonBridge;
  let mockChildProcess: EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    bridge = new AntigravityPythonBridge(() => ({ execute: async () => ({}) } as unknown as import('@co/tools').GovernedToolGateway), { redact: (s: string) => s.replace('TOP_SECRET_KEY', '[REDACTED]') } as unknown as import('@co/tools').OutputRedactor);
    mockChildProcess = Object.assign(new EventEmitter(), {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mockSpawn.mockReturnValue(mockChildProcess);
  });

  it('dispatches work package via stdin and receives JSON result', async () => {
    const handle = await bridge.dispatch(wp, ctx);
    expect(handle.status).toBe('RUNNING');
    expect(mockChildProcess.stdin.write).toHaveBeenCalled();

    const expectedResult = {
      schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
      summary: 'Done', actionsTaken: [], artifacts: [], findings: [], evidence: [],
      unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
    };

    const resultPromise = bridge.getResult({ runId: 'r1' });
    mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify(expectedResult)));
    mockChildProcess.emit('close', 0);

    const result = await resultPromise;
    console.log(result); expect(result.status).toBe('COMPLETED');
  });

  it('escalates cancellation from SIGTERM to SIGKILL', async () => {
    vi.useFakeTimers();
    await bridge.dispatch(wp, ctx);

    const cancelPromise = bridge.cancel({ runId: 'r1' });

    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');

    // Simulate python process exiting
    mockChildProcess.emit('close', 0);
    await cancelPromise;

    vi.useRealTimers();
  });

  it('handles malformed JSON output gracefully', async () => {
    await bridge.dispatch(wp, ctx);

    const resultPromise = bridge.getResult({ runId: 'r1' });
    mockChildProcess.stdout.emit('data', Buffer.from('NOT JSON'));
    mockChildProcess.emit('close', 0);

    const result = await resultPromise;
    expect(result.status).toBe('FAILED');
    expect(result.summary).toContain('Invalid JSON');
  });

  it('rejects duplicate attempt host sessions', async () => {
    await bridge.dispatch(wp, ctx);
    await expect(bridge.dispatch(wp, ctx)).rejects.toThrow('Duplicate host session for attempt: a1');
  });

  it('preserves model result (JSON containing summary + secret + governed tool output) with redaction', async () => {
    await bridge.dispatch(wp, ctx);
    const expectedResult = {
      schemaVersion: '1.0.0', runRef: { runId: 'r1' }, status: 'COMPLETED',
      summary: 'Done with secret TOP_SECRET_KEY and governed tool output',
      actionsTaken: ['exec-1'],
      artifacts: [], findings: [],
      evidence: [{ type: 'commit', claimSupported: 'did commit', sourceRef: 'ref-1' }],
      unresolvedItems: [], requestedInputs: [],
      sideEffects: ['committed a file'],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
    };

    const resultPromise = bridge.getResult({ runId: 'r1' });

    const stdinCall = (mockChildProcess.stdin.write as import("vitest").Mock).mock.calls[0][0];
    expect(stdinCall).not.toContain('TOP_SECRET_KEY');

    mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify(expectedResult)));
    mockChildProcess.emit('close', 0);

    const result = await resultPromise;
    console.log(result); expect(result.status).toBe('COMPLETED');
    // It should be redacted by the bridge
    expect(result.summary).toBe('Done with secret [REDACTED] and governed tool output');
    expect(result.summary).not.toBe('Agent execution completed');

    // Preserves actionsTaken, evidence, sideEffects
    expect(result.actionsTaken).toEqual(expectedResult.actionsTaken);
    expect(result.evidence).toEqual(expectedResult.evidence);
    expect(result.sideEffects).toEqual(expectedResult.sideEffects);

    // No raw secret
    expect(JSON.stringify(result)).not.toContain('TOP_SECRET_KEY');
  });

  it('Python SDK tool hardening', () => {
    const scriptContent = fs.readFileSync(path.resolve(__dirname, '../../packages/agents/scripts/antigravity-bridge.py'), 'utf-8');
    expect(scriptContent).toContain('BuiltinTools.none()');
    expect(scriptContent).toContain('enable_subagents=False');

    // Assert exactly the allowed forwarding tools
    const allowedTools = ['git_status', 'git_diff', 'git_show', 'git_commit', 'pnpm_qualification'];
    allowedTools.forEach(tool => expect(scriptContent).toContain(`name="${tool}"`));
  });

  it('dispatch wires attemptId to PrismaActionAuditLedger correctly', async () => {
    const { PrismaActionAuditLedger } = await import('@co/persistence');
    const { GovernedToolGateway, StaticToolPolicy } = await import('@co/tools');

    let capturedAttemptId: string | undefined;
    const mockProjectEventLedger = { append: vi.fn().mockResolvedValue(undefined), getEvents: vi.fn().mockResolvedValue([]) };

    let capturedLedger: import('@co/persistence').PrismaActionAuditLedger;
    const gatewayFactory = (attemptId: string) => {
      capturedAttemptId = attemptId;
      capturedLedger = new PrismaActionAuditLedger(mockProjectEventLedger as unknown as import("@co/contracts").ToolExecutionResult, attemptId, 'proj-1', 'task-1');
      // Dummy gateway
      return new GovernedToolGateway(new StaticToolPolicy({ allowedOperations: [] }), [], capturedLedger, {} as unknown as import("@co/contracts").ToolExecutionResult);
    };

    const testBridge = new AntigravityPythonBridge(gatewayFactory, { redact: (s: string) => s } as unknown as import('@co/tools').OutputRedactor);
    const testCtx = { ...ctx, attemptId: 'attempt-canonical', workflowRunId: 'run-different' };
    const testWp = { ...wp, workPackageId: 'wp-different' };

    // Dispatch creates IPC server which has access to the gateway
    await testBridge.dispatch(testWp, testCtx);

    // Verify gatewayFactory received the trusted context attemptId
    expect(capturedAttemptId).toBe('attempt-canonical');

    // Simulate a forged attemptId from a model proposal getting audited
    // In a real scenario, gateway.execute() calls ledger.recordProposed() with the request
    // The request might have a forged attemptId, but the PrismaActionAuditLedger ignores it for the aggregateId
    await capturedLedger.recordProposed({
      actionId: 'forged-act',
      request: { actionId: 'forged-act', correlationId: 'c1', agentId: 'ag', attemptId: 'attempt-forged' } as unknown as import("@co/contracts").ToolExecutionResult,
      classification: ['SAFE'],
      decision: { decision: 'ALLOW' } as unknown as import("@co/contracts").ToolExecutionResult,
      proposedAt: new Date()
    });

    expect(mockProjectEventLedger.append).toHaveBeenCalled();
    const event = mockProjectEventLedger.append.mock.calls[0][0];

    // Prove it ignores the forged attemptId and uses the canonical one bound at dispatch
    expect(event.aggregateType).toBe('ATTEMPT');
    expect(event.aggregateId).toBe('attempt-canonical');
    expect(event.aggregateId).not.toBe('attempt-forged');
    expect(event.aggregateId).not.toBe('wp-different');
    expect(event.aggregateId).not.toBe('run-different');
  });
});
