import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';
import { TrustedOwnerAuthorityIssuer } from '@co/policy';

describe('UC-07 Recover from Failure E2E', () => {
  it('UC-07 halts execution midway, restarts runtime context, and resumes execution seamlessly', async () => {
    const eventLedger = new InMemoryEventLedger();
    let bridgeCallCount = 0;
    const mockBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-1', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => {
        bridgeCallCount++;
        if (bridgeCallCount === 1) {
          return {
            schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Need input',
            actionsTaken: [], artifacts: [], findings: [], evidence: [{ id: 'ev-1', kind: 'info', content: 'prior evidence preserved' }], sideEffects: [], unresolvedItems: [],
            requestedInputs: [{ id: 'req-1', type: 'text', prompt: 'Input?' }], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
          };
        }
        return {
          schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Resumed and finished',
          actionsTaken: [], artifacts: [], findings: [], evidence: [{ id: 'ev-2', kind: 'info', content: 'new' }], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
        };
      },
      cancel: async () => {}
    };

    const router = new MultiAgentRouter({ selectBridge: () => mockBridge });
    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    
    // Initial run
    const coordinator1 = new RunCoordinator(router, eventLedger, reviewer, 'recover-task', { timeoutMs: 100, intervalMs: 10 });
    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-uc07', version: 1, projectId: 'proj-1', workItemId: 'recover-task',
      completionObjectRef: 'ref', objective: 'Recover', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };
    await coordinator1.execute(wp, 'run-1', 'corr-1', 'proj-1');

    // Re-hydration run
    const coordinator2 = new RunCoordinator(router, eventLedger, reviewer, 'recover-task', { timeoutMs: 100, intervalMs: 10 });
    const issuer = new TrustedOwnerAuthorityIssuer('owner-user', 'recover-task');
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED', boundToAction: 'provide_input', boundToGate: 'OWNER_PRECOMMIT' });
    await coordinator2.resumeWithAuthority('run-1', authEvent);

    const events = (eventLedger as unknown as { events: { eventType: string, payload?: { result?: { artifacts?: { kind: string }[] } } }[] }).events;
    const closed = events.some(e => e.eventType === 'RUN_CLOSED');
    
    // Compute from observed state
    const priorStatePreserved = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.requestedInputs?.[0]?.id === 'req-1');
    const priorEvidencePreserved = events.some(e => e.eventType === 'RUN_COMPLETED' && e.payload?.result?.evidence?.[0]?.content === 'prior evidence preserved');
    const externalKnowledgePreserved = priorStatePreserved && priorEvidencePreserved;
    const safeContinuation = events.some(e => e.eventType === "RUN_RESUMED") && closed;

    expect(priorStatePreserved).toBe(true);
    expect(priorEvidencePreserved).toBe(true);
    expect(externalKnowledgePreserved).toBe(true);
     expect(safeContinuation).toBe(true);

    writeSemanticEvidence('UC-07', {
      'prior execution state preserved': priorStatePreserved,
      'prior evidence preserved': priorEvidencePreserved,
      'external-state knowledge preserved': externalKnowledgePreserved,
      'safe continuation': safeContinuation
    });
  });
});
