
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ToolAdapter, ToolExecutionRequest, ToolExecutionResult, AuthorizedToolRequest } from '@co/contracts';
import { createProductionGateway } from '@co/tools';
import {
  ActionClassifyingPolicyEngine,
  InMemoryExecutionAuditLedger,
  OwnerEventProcessor,
  TrustedOwnerAuthorityIssuer,
} from '@co/policy';

const TASK_ID = 'gw-task-001';
const OWNER_REF = 'owner:test';

class MockAdapter implements ToolAdapter {
  constructor(public toolId: string = 'mock-tool') {}
  executeAuthorized = vi.fn<[AuthorizedToolRequest], Promise<ToolExecutionResult>>();
}

function req(overrides: Partial<ToolExecutionRequest> = {}): ToolExecutionRequest {
  return {
    schemaVersion: '1.0.0',
    requestId: randomUUID(),
    projectId: 'proj-1',
    actorRef: 'agent-1',
    workItemRef: TASK_ID,
    workPackageRef: 'wp-1',
    toolId: 'mock-tool',
    operationId: 'mock.do',
    targetResource: 'mock://res',
    environment: 'LOCAL',
    parameters: {},
    authorityContextRef: 'auth://1',
    idempotencyKey: 'idemp-1',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function setup() {
  const issuer = new TrustedOwnerAuthorityIssuer(OWNER_REF, TASK_ID);
  const processor = new OwnerEventProcessor({ taskId: TASK_ID, initialGate: 'COMMIT', environment: 'LOCAL' });
  const ledger = new InMemoryExecutionAuditLedger();
  const policy = new ActionClassifyingPolicyEngine(processor.readOnlyView);
  const adapter = new MockAdapter('git');
  const shellAdapter = new MockAdapter('shell');
  const gateway = createProductionGateway(policy, [adapter, shellAdapter], ledger, processor.asGrantConsumer());

  return { issuer, processor, ledger, policy, adapter, shellAdapter, gateway };
}

describe('GovernedToolGateway E2E', () => {
  it('GW-1: missing required token -> DENY, NOT_EXECUTED (adapter not called)', async () => {
    const { gateway, adapter, ledger } = setup();
    // COMMIT gate requires OWNER_COMMIT_APPROVED for git.commit
    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' } });
    const result = await gateway.execute(request);

    expect(result.status).toBe('DENIED');
    expect(adapter.executeAuthorized).not.toHaveBeenCalled();
    const denied = ledger.denied();
    expect(denied.length).toBe(1);
    expect(denied[0]?.executionResult).toBe('NOT_EXECUTED');
  });

  it('GW-2: valid token -> ALLOW, RESERVED -> CONSUMED on SUCCEEDED', async () => {
    const { gateway, adapter, issuer, processor } = setup();
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: 'task-1', boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    // Simulate successful execution
    adapter.executeAuthorized.mockResolvedValue({
      schemaVersion: '1.0.0',
      executionId: 'exec-1',
      requestId: 'req-1',
      toolId: 'git',
      operationId: 'git.commit',
      status: 'SUCCEEDED',
      summary: 'Success',
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
      reconciliationRequired: false,
    });

    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' }, requestId: 'req-1' });
    const result = await gateway.execute(request);

    expect(result.status).toBe('SUCCEEDED');
    expect(adapter.executeAuthorized).toHaveBeenCalledTimes(1);

    // Verify token consumed
    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
    const grant = processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED');
    expect(grant?.status).toBe('CONSUMED');
  });

  it('GW-3: valid token, execution fails -> RESERVED -> RECONCILIATION_REQUIRED', async () => {
    const { gateway, adapter, issuer, processor } = setup();
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: 'task-1', boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    adapter.executeAuthorized.mockResolvedValue({
      schemaVersion: '1.0.0',
      executionId: 'exec-2',
      requestId: 'req-2',
      toolId: 'git',
      operationId: 'git.commit',
      status: 'FAILED',
      summary: 'Failed',
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
      reconciliationRequired: true,
    });

    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' }, requestId: 'req-2' });
    const result = await gateway.execute(request);

    expect(result.status).toBe('FAILED');
    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
    const grant = processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED');
    expect(grant?.status).toBe('RECONCILIATION_REQUIRED');
  });

  it('GW-4: valid token, execution cancelled -> RESERVED -> ACTIVE (retry allowed)', async () => {
    const { gateway, adapter, issuer, processor } = setup();
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: 'task-1', boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    adapter.executeAuthorized.mockResolvedValue({
      schemaVersion: '1.0.0',
      executionId: 'exec-3',
      requestId: 'req-3',
      toolId: 'git',
      operationId: 'git.commit',
      status: 'CANCELLED',
      summary: 'Cancelled',
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
      reconciliationRequired: false,
    });

    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' }, requestId: 'req-3' });
    const result = await gateway.execute(request);

    expect(result.status).toBe('CANCELLED');
    // Token should be active again for retry
    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);
    const grant = processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED');
    expect(grant?.status).toBe('ACTIVE');
  });

  it('GW-5: Legacy StaticToolPolicy works', async () => {
    const { GovernedToolGateway, StaticToolPolicy } = await import('@co/tools');
    const legacyPolicy = new StaticToolPolicy({ allowedOperations: ['mock.do'] });
    const adapter = new MockAdapter();
    adapter.executeAuthorized.mockResolvedValue({
      schemaVersion: '1.0.0',
      executionId: 'exec-4',
      requestId: 'req-4',
      toolId: 'mock-tool',
      operationId: 'mock.do',
      status: 'SUCCEEDED',
      summary: 'Legacy success',
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
      reconciliationRequired: false,
    });

    // Legacy instantiation without grant consumer
    const legacyGateway = new GovernedToolGateway(legacyPolicy, [adapter]);
    const request = req({ toolId: 'mock-tool', operationId: 'mock.do' });
    const result = await legacyGateway.execute(request);

    expect(result.status).toBe('SUCCEEDED');
    expect(adapter.executeAuthorized).toHaveBeenCalledTimes(1);
  });

  it('GW-6: Guard violation -> DENY, NOT_EXECUTED', async () => {
    const { gateway, adapter, ledger, issuer, processor } = setup();
    // Gate is COMMIT, token granted, but reading .env should trigger SecretFileGuard
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: 'task-1', boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    const request = req({ toolId: 'shell', operationId: 'shell.exec', parameters: { command: 'cat .env' } });
    const result = await gateway.execute(request);

    expect(result.status).toBe('DENIED');
    expect(adapter.executeAuthorized).not.toHaveBeenCalled();
    const denied = ledger.denied();
    expect(denied[0]?.executionResult).toBe('NOT_EXECUTED');
  });

  it('GW-7: pre-exec persistence failure prevents adapter execution and fails closed', async () => {
    const { gateway, adapter, ledger, issuer, processor } = setup();
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: TASK_ID, boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    vi.spyOn(ledger, 'recordProposed').mockRejectedValue(new Error('DB Down'));

    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' } });
    const result = await gateway.execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.summary).toContain('DB Down');
    expect(adapter.executeAuthorized).not.toHaveBeenCalled();
  });

  it('GW-8: post-exec persistence failure returns UNKNOWN and requires reconciliation', async () => {
    const { gateway, adapter, ledger, issuer, processor } = setup();
    processor.applyOwnerAuthorityEvent(issuer.issueAuthorityEvent({ authorityType: 'OWNER_COMMIT_APPROVED', taskId: TASK_ID, boundToGate: 'COMMIT', boundToAction: 'GIT_COMMIT' }));

    adapter.executeAuthorized.mockResolvedValue({
      schemaVersion: '1.0.0', executionId: 'exec-5', requestId: 'req-5', toolId: 'git', operationId: 'git.commit',
      status: 'SUCCEEDED', summary: 'Success', artifacts: [], evidenceCandidates: [], sideEffects: ['commit'], reconciliationRequired: false
    });

    vi.spyOn(ledger, 'recordExecuted').mockRejectedValue(new Error('DB Down Post'));

    const request = req({ toolId: 'git', operationId: 'git.commit', parameters: { subcommand: 'commit' } });
    const result = await gateway.execute(request);

    expect(result.status).toBe('UNKNOWN');
    expect(result.reconciliationRequired).toBe(true);
    expect(result.summary).toContain('AUDIT PERSISTENCE FAILED');

    expect(processor.readOnlyView.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
    const grant = processor.readOnlyView.activeAuthorities.find(g => g.token === 'OWNER_COMMIT_APPROVED');
    expect(grant?.status).not.toBe('CONSUMED');
    expect(grant?.status).toBe('RECONCILIATION_REQUIRED');

    // a second immediate execution using the same authority is denied/blocked pending reconciliation, and the adapter is not invoked a second time.
    const secondResult = await gateway.execute(request);
    expect(secondResult.status).toBe('DENIED');
    expect(adapter.executeAuthorized).toHaveBeenCalledTimes(1); // not invoked a second time
  });
});
