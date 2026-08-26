import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntigravityPythonBridge } from '../../packages/agents/src/antigravity/antigravity-python-bridge.js';
import type { AgentRuntimeContext, WorkPackage, AgentRunResult } from '@co/contracts';
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
  let mockChildProcess: any;

  beforeEach(() => {
    bridge = new AntigravityPythonBridge();
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdin = { write: vi.fn(), end: vi.fn() };
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
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
    expect(result.status).toBe('COMPLETED');
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
});
