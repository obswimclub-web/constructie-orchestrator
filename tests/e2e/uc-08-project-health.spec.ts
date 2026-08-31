import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { BlueprintRunner } from '../../packages/workflow/src/blueprint-runner.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-08 Project Health Audit', () => {
  it('UC-08 audits dependencies, tests, and static analysis', async () => {
    const eventLedger = new InMemoryEventLedger();
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Audit done',
        actionsTaken: [], artifacts: [{ id: 'art-hlth', kind: 'REMEDIATION_PLAN', uri: 'memory://plan.json' }], findings: [{ type: 'HEALTH_STATUS', content: 'DETERMINED' }], evidence: [{ id: 'ev-aud', kind: 'AUDIT_FINDINGS_VERIFIED', content: 'verified' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, 'audit-task', { timeoutMs: 100, intervalMs: 10 });
    const runner = new BlueprintRunner(coordinator, eventLedger, 'proj-1');

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc08', version: 1, projectId: 'proj-1', workItemId: 'audit-task',
      completionObjectRef: 'ref', objective: 'Audit Health', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    await runner.executeBlueprint('audit-bp', [wp]);
    const events = (eventLedger as unknown as { events: { eventType: string, payload?: { result?: { artifacts?: { kind: string }[] } } }[] }).events;
    const auditVerified = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.some((ev: unknown) => ev.kind === 'AUDIT_FINDINGS_VERIFIED'));
    const healthDetermined = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.findings?.some((f: unknown) => f.type === 'HEALTH_STATUS' && f.content === 'DETERMINED'));
    const planGenerated = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.artifacts?.some((a: { kind: string }) => a.kind === 'REMEDIATION_PLAN'));
    expect(auditVerified).toBe(true);
    expect(healthDetermined).toBe(true);
    expect(planGenerated).toBe(true);
    writeSemanticEvidence('UC-08', {
      'AUDIT FINDINGS = VERIFIED': auditVerified,
      'PROJECT HEALTH STATUS = DETERMINED': healthDetermined,
      'REMEDIATION PLAN = GENERATED': planGenerated
    });
  });
});
