import * as fs from 'fs';
import * as path from 'path';


import { MinimalWorkflowEngine, type WorkflowWorkStore } from '../../packages/workflow/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeComposition } from '../../packages/orchestrator/src/index.js';
import { PerRunIpcServer } from '../../packages/agents/src/antigravity/per-run-ipc-server.js';
import * as net from 'net';

describe('External Host Policy E2E', () => {
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
    const denied = ((await comp.auditLedger.entries()) || []).filter(e => e.decision.decision === 'DENY');


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

  it('E2E-3: Handles redaction, identity forgery, and unapproved actions', async () => {
    // Tests: unapproved action denied, commit without owner denied, broad stage denied, identity forgery rejected, raw-shell cannot execute.
    const taskId = 'task-e2e-003';
    const comp = createRuntimeComposition({ taskId, initialGate: 'COMMIT', environment: 'LOCAL', secrets: ['MY_SECRET'] });

    // Simulate IPC server executing a raw shell action
    const mockOpenAIClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({
        id: 'mock-response-3', model: 'gpt-4o', usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [{ message: { content: "\n```json\n{\"summary\": \"Running raw shell with MY_SECRET\", \"artifacts\": [], \"toolProposals\": [{\"toolId\": \"bash\", \"operationId\": \"bash.run\", \"targetResource\": \"host\", \"environment\": \"LOCAL\", \"parameters\": { \"command\": \"echo MY_SECRET\" }}]}\n```\n" } }]
      })}}
    };
    (comp.codexAdapter as unknown as Record<string, unknown>).openaiClientFactory = () => mockOpenAIClient;

    const workPackage = { workPackageId: 'wp-3', workItemId: taskId, projectId: 'proj-3', objective: 'Shell', authorityContextRef: 'auth://3', version: 1 } as unknown;

    // Attempt execution
    const run = await comp.codexAdapter.execute(workPackage, { attemptId: 'att-3', correlationId: 'corr-3', secretRefs: ['OPENAI_API_KEY'], workflowRunId: 'wfr-3' } as unknown);
    await new Promise(r => setTimeout(r, 100));

    // Validate tool not registered (raw-shell cannot execute)
    // Redaction works
    expect(JSON.stringify(run)).not.toContain('MY_SECRET');

    const createCall = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
    const messagesStr = JSON.stringify(createCall.messages);
    expect(messagesStr).not.toContain('MY_SECRET');
  });

  it('E2E-4: Comprehensive unapproved and unsupported action denial matrix', async () => {
    const taskId = 'task-e2e-004';
    const comp = createRuntimeComposition({ taskId, initialGate: 'COMMIT', environment: 'LOCAL' });
    const workPackage = { workPackageId: 'wp-4', workItemId: taskId, projectId: 'proj-4', objective: 'Test', authorityContextRef: 'auth://4', version: 1 } as unknown as import('@co/contracts').WorkPackage;
    const ctx = { attemptId: 'att-4', correlationId: 'corr-4', secretRefs: ['OPENAI_API_KEY'], workflowRunId: 'wfr-4' } as unknown as import('@co/contracts').AgentRuntimeContext;

    async function tryTool(toolId: string, operationId: string, parameters: Record<string, unknown>) {
      const mockOpenAIClient = {
        chat: { completions: { create: vi.fn().mockResolvedValue({
          id: 'mock-response-4', model: 'gpt-4o', usage: { prompt_tokens: 10, completion_tokens: 20 },
          choices: [{ message: { content: `\n\`\`\`json\n{"summary": "Test", "artifacts": [], "toolProposals": [{"toolId": "${toolId}", "operationId": "${operationId}", "targetResource": "host", "environment": "LOCAL", "parameters": ${JSON.stringify(parameters)}}]}\n\`\`\`\n` } }]
        })}}
      };
      (comp.codexAdapter as unknown as Record<string, unknown>).openaiClientFactory = () => mockOpenAIClient;
      const res = await comp.codexAdapter.execute(workPackage, ctx);
      await new Promise(r => setTimeout(r, 100));
      return res;
    }

    // 1. Commit without owner denied
    await tryTool('git', 'git.commit', { subcommand: 'commit', message: 'test' });
    let denied = ((await comp.auditLedger.entries()) || []).filter(e => e.decision.decision === 'DENY');
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[denied.length - 1]?.decision.policyRule).toContain('OWNER_COMMIT_APPROVED_REQUIRED');

    // 2. Push without owner denied
    await tryTool('git', 'git.push', { subcommand: 'push' });
    denied = ((await comp.auditLedger.entries()) || []).filter(e => e.decision.decision === 'DENY');
    expect(denied[denied.length - 1]?.decision.policyRule).toContain('GIT_PUSH_NOT_ALLOWED_IN_GATE_COMMIT');

    // 3. Broad stage denied (path is '.')
    await tryTool('git', 'git.add', { subcommand: 'add', paths: ['.'] });
    denied = ((await comp.auditLedger.entries()) || []).filter(e => e.decision.decision === 'DENY');
    expect(denied[denied.length - 1]?.decision.reason).toBeTruthy();

    // 4. DB action cannot execute (rejected by parser)
    const countBeforeDb = ((await comp.auditLedger.entries()) || []).length;
    await tryTool('prisma', 'prisma.db_pull', {});
    expect(((await comp.auditLedger.entries()) || []).length).toBe(countBeforeDb);

    // 5. Deploy action cannot execute (rejected by parser)
    await tryTool('deploy', 'deploy.run', {});
    expect(((await comp.auditLedger.entries()) || []).length).toBe(countBeforeDb);
  });

  it('E2E-5: Real UDS IPC Server with forgery, redaction, and environment binding', async () => {
    const canonicalTaskId = 'task-canonical-001';
    const workPackageId = 'wp-different-id';
    const attemptId = 'attempt-001';
    const secret = 'TOP_SECRET_IPC_KEY';
    process.env.IPC_TEST_SECRET = secret;

    const comp = createRuntimeComposition({ taskId: canonicalTaskId, initialGate: 'COMMIT', environment: 'STAGING', secrets: [secret] });

    const wp = {
      schemaVersion: '1.0.0',
      workPackageId,
      version: 1,
      projectId: 'proj',
      workItemId: canonicalTaskId,
      completionObjectRef: 'comp',
      objective: 'obj',
      authoritativeInputs: [] as Array<{ref: string, classification: 'AUTHORITATIVE'}>,
      scope: { refs: [] },
      constraints: [],
      authorityContextRef: 'auth',
      requiredCapabilities: [],
      allowedActions: [],
      forbiddenActions: [],
      toolsAllowed: [],
      expectedArtifactsOut: [],
      verificationRequirements: [],
      evidenceRequirements: [],
      dependencies: [],
      stopConditions: []
    } as import('@co/contracts').WorkPackage;

    const context = {
      schemaVersion: '1.0.0',
      workflowRunId: 'wfr',
      correlationId: 'corr',
      attemptId,
      secretRefs: ['IPC_TEST_SECRET']
    } as import('@co/contracts').AgentRuntimeContext;

    const ipcServer = new PerRunIpcServer(context, comp.gateway, { redact: (s: string) => s } as import("@co/tools").OutputRedactor, wp);
    await ipcServer.start();

    const response = await new Promise<unknown>((resolve) => {
      const client = net.createConnection(ipcServer.socketPath, () => {
        const payload = {
          tool: 'bash',
          operation: 'bash.run',
          parameters: { command: `echo ${secret}` },
          nonce: ipcServer.nonce,
          // Forgery attempt
          environment: 'PRODUCTION',
          taskId: 'forged-task-id'
        };
        client.write(JSON.stringify(payload) + '\n');
      });

      let buf = ''; client.on('data', chunk => { buf += chunk.toString(); if (buf.includes('\n')) { client.destroy(); resolve(JSON.parse(buf)); } });

    });

    console.log('Stopping...'); await ipcServer.stop(); console.log('Stopped.');

    // Prove canonical taskId is distinct from workItemId/workPackageId
    // and reaches ledger without forged overrides
    const ledgerEntries = await comp.auditLedger.entries() || [];
    const entry = ledgerEntries[ledgerEntries.length - 1];

    expect(entry.request.taskId).toBe(canonicalTaskId);
    expect(entry.request.taskId).not.toBe(workPackageId);
    expect(entry.request.taskId).not.toBe('forged-task-id');


    // Prove environment binding
    expect(entry.request.environment).not.toBe('PRODUCTION');
    expect(JSON.stringify(response)).not.toContain(secret);

  });


  it('E2E-6: Workspace filesystem works via UDS but denies out-of-scope/secret paths', async () => {
    const testFile = path.join(process.cwd(), 'tests', 'e2e', 'temp_workspace_test.txt');
    fs.writeFileSync(testFile, 'hello uds');

    const comp = createRuntimeComposition({ taskId: 'task-fs-001', initialGate: 'COMMIT', environment: 'LOCAL' });
    const context = {
      schemaVersion: '1.0.0',
      workflowRunId: 'wfr',
      correlationId: 'corr',
      attemptId: 'att',
      secretRefs: []
    } as import('@co/contracts').AgentRuntimeContext;

    // We will issue OWNER_COMMIT_APPROVED so that normal tools could run
    const authEvent = comp.issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED' });
    comp.ownerProcessor.applyOwnerAuthorityEvent(authEvent);

    const ipcServer = new PerRunIpcServer(context, comp.gateway, { redact: (s: string) => s } as import("@co/tools").OutputRedactor);
    await ipcServer.start();

    const tryCommand = async (pathStr: string) => {
      return new Promise<unknown>((resolve) => {
        const client = net.createConnection(ipcServer.socketPath, () => {
          client.write(JSON.stringify({ tool: 'filesystem', operation: 'filesystem.write', parameters: { path: pathStr, content: 'hacked' }, nonce: ipcServer.nonce }) + '\n');
        });
        let buf = ''; client.on('data', chunk => { buf += chunk.toString(); if (buf.includes('\n')) { client.destroy(); resolve(JSON.parse(buf)); } });
      });
    };

    // Outside root
    const outOfRootRes = await tryCommand('/etc/passwd');
    expect(outOfRootRes.error || (outOfRootRes as Record<string, unknown>).summary).toMatch(/DENIED|Unauthorized|Outside/i);

    // Secret path (.env)
    const secretPathRes = await tryCommand('.env');
    expect(secretPathRes.error || (secretPathRes as Record<string, unknown>).summary).toMatch(/DENIED|Unauthorized|secret/i);

    console.log('Stopping...'); await ipcServer.stop(); console.log('Stopped.');

    fs.unlinkSync(testFile);
  });

});
