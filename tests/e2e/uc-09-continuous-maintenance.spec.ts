import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-09 Continuous Maintenance', () => {
  it('UC-09 executes a continuous maintenance cycle', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Maintenance done',
        actionsTaken: [], artifacts: [{ id: 'art-truth', kind: 'SOURCE_OF_TRUTH_CURRENT', uri: 'memory://truth.json' }], findings: [{ type: 'CRITICAL_ISSUES', content: '0' }, { type: 'HEALTH_STATUS', content: 'ACCEPTABLE' }], evidence: [{ id: 'ev-op', kind: 'PROJECT_OPERATIONAL', content: 'yes' }, { id: 'ev-loop', kind: 'MAINTENANCE_LOOP_ACTIVE', content: 'yes' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'maintenance-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc09', version: 1, projectId: 'proj-1', workItemId: 'maintenance-task',
      completionObjectRef: 'ref', objective: 'Continuous Maintenance', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('maintenance-bp', [wp]);
    const events = (eventLedger as any).events;
    const projOp = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: any) => ev.kind === 'PROJECT_OPERATIONAL'));
    const hlthAcc = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'HEALTH_STATUS' && f.content === 'ACCEPTABLE'));
    const critZero = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: any) => f.type === 'CRITICAL_ISSUES' && f.content === '0'));
    const loopAct = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: any) => ev.kind === 'MAINTENANCE_LOOP_ACTIVE'));
    const truthCur = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: any) => a.kind === 'SOURCE_OF_TRUTH_CURRENT'));
    
    expect(projOp).toBe(true);
    expect(hlthAcc).toBe(true);
    expect(critZero).toBe(true);
    expect(loopAct).toBe(true);
    expect(truthCur).toBe(true);
    
    writeSemanticEvidence('UC-09', {
      'PROJECT OPERATIONAL': projOp,
      'HEALTH STATUS = ACCEPTABLE': hlthAcc,
      'CRITICAL UNRESOLVED ISSUES = 0': critZero,
      'MAINTENANCE LOOP = ACTIVE': loopAct,
      'SOURCE OF TRUTH = CURRENT': truthCur
    });
  });
});
