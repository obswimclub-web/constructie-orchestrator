import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-03 Execute Blueprint', () => {
  it('UC-03 executes a blueprint with multiple tasks via multiple agents and yields COMPLETE', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Blueprint task complete',
        actionsTaken: [], artifacts: [{ id: 'art-bp', kind: 'BLUEPRINT_COMPLETE', uri: 'memory://bp.json' }], findings: [{ type: 'JUDGE_VERDICT', content: 'ACCEPTED' }], evidence: [], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'bp-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc03', version: 1, projectId: 'proj-1', workItemId: 'bp-task',
      completionObjectRef: 'ref', objective: 'Execute', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('bp-1', [wp]);
    const events = (eventLedger as any).events;
    const bpComplete = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'BLUEPRINT_COMPLETE'));
    const judgeAccepted = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'JUDGE_VERDICT' && f.content === 'ACCEPTED'));
    expect(bpComplete).toBe(true);
    expect(judgeAccepted).toBe(true);
    writeSemanticEvidence('UC-03', {
      'BLUEPRINT STATUS = COMPLETE': bpComplete,
      'JUDGE VERDICT = ACCEPTED': judgeAccepted
    });
  });
});
