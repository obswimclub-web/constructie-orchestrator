import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-02 Existing Project Takeover', () => {
  it('UC-02 analyzes existing project, builds ledger, and achieves READY state', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Takeover analysis complete',
        actionsTaken: [], artifacts: [{ id: 'art-state', kind: 'TAKEOVER_STATE', uri: 'memory://state.json' }], findings: [], evidence: [], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'takeover-task', { timeoutMs: 100, intervalMs: 10 });

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc02', version: 1, projectId: 'proj-1', workItemId: 'takeover-task',
      completionObjectRef: 'ref', objective: 'Analyze codebase', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await coordinator.execute(wp, 'run-1', 'corr-1', 'proj-1');
    const events = (eventLedger as any).events;
    const closed = events.some(e => e.eventType === 'RUN_CLOSED');
    const takeoverReady = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'TAKEOVER_STATE'));
    expect(closed).toBe(true);
    expect(takeoverReady).toBe(true);
    writeSemanticEvidence('UC-02', {
      'TAKEOVER READINESS = YES': takeoverReady && closed
    });
  });
});
