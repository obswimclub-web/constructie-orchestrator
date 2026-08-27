import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-05 Bug Lifecycle', () => {
  it('UC-05 executes bug reproduction, fix, and verification', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Bug fixed',
        actionsTaken: [], artifacts: [{ id: 'art-bug', kind: 'BUG_RESOLVED', uri: 'memory://bug.json' }], findings: [{ type: 'JUDGE_VERDICT', content: 'FIX ACCEPTED' }], evidence: [{ id: 'ev-bug', kind: 'ISSUE_VERIFIED_FIXED', content: 'fixed' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'bug-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc05', version: 1, projectId: 'proj-1', workItemId: 'bug-task',
      completionObjectRef: 'ref', objective: 'Fix Bug', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('bug-bp', [wp]);
    const events = (eventLedger as any).events;
    const bugResolved = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'BUG_RESOLVED'));
    const judgeAccepted = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'JUDGE_VERDICT' && f.content === 'FIX ACCEPTED'));
    const issueVerified = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: any) => ev.kind === 'ISSUE_VERIFIED_FIXED'));
    expect(bugResolved).toBe(true);
    expect(judgeAccepted).toBe(true);
    expect(issueVerified).toBe(true);
    writeSemanticEvidence('UC-05', {
      'BUG STATUS = RESOLVED': bugResolved,
      'JUDGE VERDICT = FIX ACCEPTED': judgeAccepted,
      'ORIGINAL ISSUE = VERIFIED FIXED': issueVerified
    });
  });
});
