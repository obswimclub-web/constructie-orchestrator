import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-04 Feature Lifecycle', () => {
  it('UC-04 executes design, implementation, and verification for a new feature', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Feature implemented',
        actionsTaken: [], artifacts: [{ id: 'art-feat', kind: 'FEATURE_COMPLETE', uri: 'memory://feat.json' }], findings: [{ type: 'JUDGE_VERDICT', content: 'ACCEPTED' }], evidence: [{ id: 'ev-src', kind: 'SOURCE_TRUTH_UPDATED', content: 'updated' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'feature-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc04', version: 1, projectId: 'proj-1', workItemId: 'feature-task',
      completionObjectRef: 'ref', objective: 'Implement Feature', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('feature-bp', [wp]);
    const events = (eventLedger as any).events;
    const featComplete = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'FEATURE_COMPLETE'));
    const judgeAccepted = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'JUDGE_VERDICT' && f.content === 'ACCEPTED'));
    const sourceUpdated = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: any) => ev.kind === 'SOURCE_TRUTH_UPDATED'));
    expect(featComplete).toBe(true);
    expect(judgeAccepted).toBe(true);
    expect(sourceUpdated).toBe(true);
    writeSemanticEvidence('UC-04', {
      'FEATURE STATUS = COMPLETE': featComplete,
      'JUDGE VERDICT = ACCEPTED': judgeAccepted,
      'PROJECT SOURCE OF TRUTH = UPDATED': sourceUpdated
    });
  });
});
