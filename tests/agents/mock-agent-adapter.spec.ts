import { describe, expect, it } from 'vitest';
import { MockAgentAdapter, AgentResultValidationError } from '../../packages/agents/src/index.js';
import type { WorkPackage, AgentRuntimeContext } from '../../packages/contracts/src/index.js';

const wp: WorkPackage = {
  schemaVersion: '1.0.0', workPackageId: 'wp-1', version: 1, projectId: 'p-1', workItemId: 'w-1', completionObjectRef: 'feature:ping', objective: 'Add ping',
  authoritativeInputs: [], scope: { refs: ['repo://sample'] }, constraints: [], authorityContextRef: 'authority://1', requiredCapabilities: ['code_modification'], allowedActions: ['repository.write'], forbiddenActions: [], toolsAllowed: ['git'], expectedArtifactsOut: ['PATCH'], verificationRequirements: ['tests'], evidenceRequirements: ['test-report'], dependencies: [], stopConditions: [],
};
const ctx: AgentRuntimeContext = { correlationId: 'c1', workflowRunId: 'wf1', attemptId: 'a1', secretRefs: [] };

describe('MockAgentAdapter', () => {
  it('returns a deterministic successful normalized result', async () => {
    const a = new MockAgentAdapter('SUCCESS'); const handle = await a.start(wp, ctx); const result = await a.getResult(handle);
    expect(handle.status).toBe('COMPLETED'); expect(result.status).toBe('COMPLETED'); expect(result.artifacts[0]?.type).toBe('PATCH');
  });
  it('simulates malformed provider output without leaking invalid data', async () => {
    const a = new MockAgentAdapter('MALFORMED_RESULT'); const handle = await a.start(wp, ctx);
    await expect(a.getResult(handle)).rejects.toBeInstanceOf(AgentResultValidationError);
  });
  it('supports interruption and provider-neutral resume', async () => {
    const a = new MockAgentAdapter('INTERRUPTED'); const handle = await a.start(wp, ctx); expect(handle.status).toBe('INTERRUPTED');
    const resumed = await a.resume({ runRef: handle, runtimeContext: ctx }); expect(resumed.status).toBe('COMPLETED');
  });
});
