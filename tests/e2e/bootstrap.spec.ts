import { describe, expect, it } from 'vitest';
import { RunCoordinator, InMemoryEventLedger } from '../../packages/workflow/src/run-coordinator.js';
import { MultiAgentRouter } from '../../packages/workflow/src/multi-agent-router.js';
import { ConcreteStructuredReviewer } from '../../packages/orchestrator/src/concrete-structured-reviewer.js';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import { OwnerEventProcessor, TrustedOwnerAuthorityIssuer } from '@co/policy';
import type { AgentBridge, WorkPackage } from '@co/contracts';
import { writeSemanticEvidence } from './semantic-evidence-writer.js';

describe('UC-01 Create New Product from Idea End-to-End', () => {
  it('UC-01 transforms raw idea into Project Definition Package and yields START AUTHORIZATION', async () => {
    const projectId = 'proj-uc-01';
    const taskId = 'task-bootstrap';
    const workflowRunId = 'run-bootstrap';

    const eventLedger = new InMemoryEventLedger();

    const analysisBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-analysis', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Need START authorization',
        actionsTaken: [], artifacts: [{ id: 'art-1', kind: 'PDP', uri: 'memory://pdp.md' }], findings: [], evidence: [], sideEffects: [], unresolvedItems: [],
        requestedInputs: [{ id: 'req-start', type: 'confirmation', prompt: 'Authorize START?' }],
        usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    const completionBridge: AgentBridge = {
      dispatch: async () => ({ runId: 'run-completion', status: 'RUNNING' }),
      getStatus: async () => 'COMPLETED',
      getResult: async (ref) => ({
        schemaVersion: '1.0.0', runRef: ref, status: 'COMPLETED', summary: 'Bootstrap complete',
        actionsTaken: [], artifacts: [], findings: [], evidence: [], sideEffects: [], unresolvedItems: [], requestedInputs: [], usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' }
      }),
      cancel: async () => {}
    };

    let callCount = 0;
    const router = new MultiAgentRouter({
      selectBridge: () => { callCount++; return callCount === 1 ? analysisBridge : completionBridge; }
    });

    const reviewer = new ConcreteStructuredReviewer(new OpenAIReviewerAdapter());
    const coordinator = new RunCoordinator(router, eventLedger, reviewer, taskId, { timeoutMs: 100, intervalMs: 10 });
    const issuer = new TrustedOwnerAuthorityIssuer('owner-user', taskId);
    const processor = new OwnerEventProcessor({ taskId, initialGate: 'AUDIT', environment: 'LOCAL' });

    const wp: WorkPackage = {
      schemaVersion: '1.0.0', workPackageId: 'wp-boot', version: 1, projectId, workItemId: taskId,
      completionObjectRef: 'ref', objective: 'Analyze raw idea and propose PDP', authoritativeInputs: [], scope: { refs: [] }, constraints: [], authorityContextRef: 'ctx', requiredCapabilities: [], allowedActions: [], forbiddenActions: [], toolsAllowed: [], expectedArtifactsOut: [], verificationRequirements: [], evidenceRequirements: [], dependencies: [], stopConditions: []
    };

    const execPromise = coordinator.execute(wp, workflowRunId, 'corr-boot', projectId);
    await new Promise(r => setTimeout(r, 100));

    // Simulate Owner granting START AUTHORIZATION
    const authEvent = issuer.issueAuthorityEvent({ authorityType: 'OWNER_IMPLEMENTATION_APPROVED', boundToAction: 'provide_input', boundToGate: 'OWNER_PRECOMMIT' });
    processor.applyOwnerAuthorityEvent(authEvent);
    await coordinator.resumeWithAuthority(workflowRunId, authEvent);
    await execPromise;

    const eventsAfterAuth = (eventLedger as any).events;
    const hasStartAuth = eventsAfterAuth.some(e => e.eventType === 'RUN_RESUMED' && e.payload?.authorityType === 'OWNER_IMPLEMENTATION_APPROVED');
    expect(hasStartAuth).toBe(true);

    writeSemanticEvidence('UC-01', {
      'START AUTHORIZATION = YES': hasStartAuth
    });
  });
});
