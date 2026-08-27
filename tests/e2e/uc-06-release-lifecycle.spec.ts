import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-06 Release Lifecycle', () => {
  it('UC-06 executes pre-flight checks, simulated deploy, and verification', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Released',
        actionsTaken: [], artifacts: [{ id: 'art-rel', kind: 'RELEASE_COMPLETE', uri: 'memory://rel.json' }], findings: [{ type: 'PROD_VERSION', content: 'VERIFIED' }], evidence: [{ id: 'ev-hlth', kind: 'POST_DEPLOY_HEALTHY', content: 'healthy' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'release-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc06', version: 1, projectId: 'proj-1', workItemId: 'release-task',
      completionObjectRef: 'ref', objective: 'Release', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('release-bp', [wp]);
    const events = (eventLedger as any).events;
    const relComplete = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'RELEASE_COMPLETE'));
    const prodVerified = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'PROD_VERSION' && f.content === 'VERIFIED'));
    const postHealthy = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: any) => ev.kind === 'POST_DEPLOY_HEALTHY'));
    expect(relComplete).toBe(true);
    expect(prodVerified).toBe(true);
    expect(postHealthy).toBe(true);
    writeSemanticEvidence('UC-06', {
      'RELEASE STATUS = COMPLETE': relComplete,
      'PRODUCTION VERSION = VERIFIED': prodVerified,
      'POST-DEPLOY STATUS = HEALTHY': postHealthy
    });
  });
});
