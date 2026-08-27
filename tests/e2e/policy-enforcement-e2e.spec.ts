import { MinimalWorkflowEngine, type WorkflowWorkStore } from '../../packages/workflow/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeComposition } from '../../packages/orchestrator/src/index.js';

describe('Policy Enforcement E2E (Full Composition Root)', () => {
  it('E2E-1: Real composition wires all components and enforces policy', async () => {
    // 1. Create real composition
    const taskId = 'task-e2e-001';
    const comp = createRuntimeComposition({ taskId, initialGate: 'COMMIT', environment: 'LOCAL' });

    expect(comp.issuer).toBeDefined();
    expect(comp.ownerProcessor).toBeDefined();
    expect(comp.policyView).toBeDefined();
    expect(comp.gateway).toBeDefined();
    expect(comp.codexAdapter).toBeDefined();
    expect(comp.auditLedger).toBeDefined();

    // 2. We mock the OpenAI client to return a structured provider output that proposes a git commit
    const mockOpenAIClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: 'mock-response-1',
            model: 'gpt-4o',
            usage: { prompt_tokens: 10, completion_tokens: 20 },
            choices: [{
              message: {
                content: `
\`\`\`json
{
  "summary": "Committing changes",
  "artifacts": [],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.commit",
      "targetResource": "repo://local",
      "environment": "LOCAL",
      "parameters": { "subcommand": "commit" }
    }
  ]
}
\`\`\`
                `
              }
            }]
          })
        }
      }
    };

    // Inject mock OpenAI factory into CodexAdapter via reflective access for test purposes
    (comp.codexAdapter as unknown as Record<string, unknown>).openaiClientFactory = () => mockOpenAIClient;

    // 3. Try to execute work package — NO token granted yet
    const workPackage = {
      workPackageId: 'wp-1',
      workItemId: taskId,
      projectId: 'proj-1',
      objective: 'Please commit the code.',
      authorityContextRef: 'auth://1'
    };

    const ctx = {
      attemptId: 'att-1',
      correlationId: 'corr-1',
      secretRefs: ['OPENAI_API_KEY'],
    };

    process.env.OPENAI_API_KEY = 'test-key';

    // The adapter runs the model (direct call), parses output, proposes tool through gateway.
    // Gateway evaluates action using ActionClassifyingPolicyEngine.
    // Since no token is present, it will DENY and NOT call the ToolAdapter.
    await comp.codexAdapter.execute(workPackage, ctx);

    // Wait a bit for the un-awaited async execution in adapter to finish
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check audit ledger for the denial
    const denied = comp.auditLedger.entries().filter(e => e.executionResult === 'NOT_EXECUTED');
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0]?.decision.decision).toBe('DENY');
    expect(denied[0]?.decision.policyRule).toBe('OWNER_COMMIT_APPROVED_REQUIRED');

    // 4. Now grant the token and try again
    const authEvent = comp.issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    comp.ownerProcessor.applyOwnerAuthorityEvent(authEvent);
    expect(comp.policyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);

    await comp.codexAdapter.execute(workPackage, ctx);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Since git tool is not registered in the real composition's adapters list by default,
    // it will throw ToolNotRegisteredError inside GovernedToolGateway BEFORE execution.
    // That proves policy ALLOWED the action, but because it didn't execute, the grant remains ACTIVE.

    const grant = comp.policyView.activeAuthorities.find(a => a.token === 'OWNER_COMMIT_APPROVED');
    expect(grant).toBeDefined();
    expect(grant?.status).toBe('ACTIVE');
  });

  it('E2E-2: Tool denial propagated to MinimalWorkflowEngine AgentRunResult', async () => {
    const taskId = 'task-e2e-002';
    const comp = createRuntimeComposition({ taskId, initialGate: 'COMMIT', environment: 'LOCAL' });

    const mockOpenAIClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({
        id: 'mock-response-2', model: 'gpt-4o', usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [{ message: { content: "\n```json\n{\"summary\": \"Committing changes\", \"artifacts\": [], \"toolProposals\": [{\"toolId\": \"git\", \"operationId\": \"git.commit\", \"targetResource\": \"repo://local\", \"environment\": \"LOCAL\", \"parameters\": { \"subcommand\": \"commit\" }}]}\n```\n" } }]
      })}}
    };
    (comp.codexAdapter as unknown as Record<string, unknown>).openaiClientFactory = () => mockOpenAIClient;

    const workPackage = { workPackageId: 'wp-2', workItemId: taskId, projectId: 'proj-2', objective: 'Commit', authorityContextRef: 'auth://2', version: 1 } as unknown as import('@co/contracts').WorkPackage;

    class FakeStore implements WorkflowWorkStore {
      workItem = { id: taskId, projectId: 'proj-2', lifecycleState: 'READY', targetGate: 'COMMIT', revision: 1, currentAttemptId: null, createdAt: new Date(), updatedAt: new Date(), requiredCapabilities: [] };
      attempt = null;
      async startAttempt(input) {
        this.attempt = input.attempt;
        this.workItem.lifecycleState = 'ASSIGNED';
        return { workItem: this.workItem, attempt: this.attempt };
      }
      async bindAgentRun() { return this.attempt; }
      async transitionAttempt(input) {
        this.attempt.state = input.to;
        return this.attempt;
      }
      async transitionWorkItem(input) {
        this.workItem.lifecycleState = input.to;
        return this.workItem;
      }
    }

    const store = new FakeStore();
    const engine = new MinimalWorkflowEngine(store);

    process.env.OPENAI_API_KEY = 'test-key';

        const origExecute = comp.codexAdapter.execute.bind(comp.codexAdapter);
    comp.codexAdapter.execute = async (wp, ctx) => {
       ctx.secretRefs = ['OPENAI_API_KEY'];
       const run = await origExecute(wp, ctx);
       await new Promise(r => setTimeout(r, 100));
       return run;
    };

    const result = await engine.execute({
      workItem: store.workItem,
      workPackage,
      adapter: comp.codexAdapter,
      correlationId: 'corr-2',
      workflowRunId: 'wf-2',
    });

    expect(result.attempt.state).toBe('FAILED');
    expect(result.workItem.lifecycleState).toBe('REPAIR_REQUIRED');

    const denialEvidence = result.agentResult?.evidence?.find(e => e.type === 'tool_denial');
    expect(denialEvidence).toBeDefined();
    expect(denialEvidence?.claimSupported).toContain('OWNER_COMMIT_APPROVED_REQUIRED');
  });
});
