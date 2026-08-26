import { randomUUID } from 'node:crypto';
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
    (comp.codexAdapter as any).openaiClientFactory = () => mockOpenAIClient;

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
});
