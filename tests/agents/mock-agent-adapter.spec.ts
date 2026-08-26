import { describe, expect, it } from 'vitest';
import { AgentResultValidationError, MockAgentAdapter } from '@co/agents';
import { randomUUID } from 'node:crypto';
import type { AgentRuntimeContext, WorkPackage } from '@co/contracts';

const ctx: AgentRuntimeContext = { correlationId: randomUUID(), workflowRunId: randomUUID(), attemptId: randomUUID(), secretRefs: [] };
const wp: WorkPackage = { schemaVersion: '1.0.0', workPackageId: 'wp', version: 1, projectId: 'p1', workItemId: 'w1', completionObjectRef: 'c1', objective: 'Test', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'a1', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: [] };

describe('MockAgentAdapter', () => {
  it('returns a deterministic successful normalized result', async () => {
    const a = new MockAgentAdapter('SUCCESS'); const handle = await a.execute(wp, ctx);
    const status = await a.getStatus(handle);
    const artifacts = await a.getArtifacts(handle);
    expect(handle.status).toBe('COMPLETED'); expect(status).toBe('COMPLETED');
    expect(artifacts).toHaveLength(1);
  });
  it('simulates malformed provider output without leaking invalid data', async () => {
    const a = new MockAgentAdapter('MALFORMED_RESULT'); const handle = await a.execute(wp, ctx);
    await expect(a.getArtifacts(handle)).rejects.toBeInstanceOf(AgentResultValidationError);
  });
  it('supports interruption and provider-neutral resume', async () => {
    const a = new MockAgentAdapter('INTERRUPTED'); const handle = await a.execute(wp, ctx);
    const resumed = await a.resume({ runRef: handle, runtimeContext: ctx });
    expect(resumed.status).toBe('COMPLETED');
  });
});
