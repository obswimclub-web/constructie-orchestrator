import { describe, it, expect, vi } from 'vitest';
import { PrismaActionAuditLedger } from '@co/persistence';

describe('Action Audit Persistence Behavioral', () => {
  it('persists HOST_ACTION_PROPOSED, HOST_ACTION_EXECUTION_COMPLETED, HOST_ACTION_RECONCILIATION_REQUIRED with monotonic revisions and correct ids', async () => {
    const mockLedger = {
      getEvents: vi.fn().mockResolvedValue([{ aggregateRevision: 5 }]),
      append: vi.fn().mockResolvedValue(undefined)
    } as unknown;

    const audit = new PrismaActionAuditLedger(mockLedger as import('@co/policy').ActionRequest, 'attempt-1', 'proj-1', 'task-1', { redact: s => s.replace('secret_token_123', '[REDACTED]') });

    await audit.recordProposed({
      actionId: 'act-1',
      request: { actionId: 'act-1', correlationId: 'corr-1', agentId: 'agent-1' } as import('@co/policy').ActionRequest,
      decision: { decision: 'ALLOW' } as import('@co/policy').ActionRequest,
      classification: ['SAFE'],
      proposedAt: new Date()
    });

    expect(mockLedger.append).toHaveBeenCalledTimes(2);
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[0][0].aggregateRevision).toBe(6);
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[0][0].eventType).toBe('HOST_ACTION_PROPOSED');
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[0][0].aggregateId).toBe('attempt-1');
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[0][0].projectId).toBe('proj-1');
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[1][0].eventType).toBe('HOST_ACTION_POLICY_DECIDED');
    expect((mockLedger.append as import('@co/policy').ActionRequest).mock.calls[1][0].aggregateRevision).toBe(7);

    // Full result persisted
    await audit.recordExecuted('act-1', {
      schemaVersion: '1.0.0', executionId: 'exec-1', requestId: 'req-1', toolId: 't-1', operationId: 'o-1',
      status: 'SUCCEEDED', summary: 'ok secret_token_123', evidenceCandidates: [], sideEffects: [], reconciliationRequired: false
    } as import('@co/contracts').ToolExecutionResult);

    expect(mockLedger.append).toHaveBeenCalledTimes(3);
    const executionCall = (mockLedger.append as import("vitest").Mock).mock.calls[2][0];
    expect(executionCall.eventType).toBe('HOST_ACTION_EXECUTION_COMPLETED');
    expect(executionCall.payload.result.executionId).toBe('exec-1');
    expect(executionCall.payload.result.requestId).toBe('req-1');
    expect(executionCall.payload.result.toolId).toBe('t-1');
    expect(executionCall.payload.result.operationId).toBe('o-1');
    expect(executionCall.payload.result.status).toBe('SUCCEEDED');
    expect(executionCall.payload.result.evidenceCandidates).toBeDefined();
    expect(executionCall.payload.result.sideEffects).toBeDefined();
    expect(executionCall.payload.result.reconciliationRequired).toBe(false);

    // secret should be redacted
    const payloadStr = JSON.stringify(executionCall.payload);
    expect(payloadStr).not.toContain('secret_token_123');

    // Reconciliation required when UNKNOWN
    await audit.recordExecuted('act-2', {
      schemaVersion: '1.0.0', executionId: 'exec-2', requestId: 'req-2', toolId: 't-2', operationId: 'o-2', status: 'UNKNOWN', summary: 'unknown error', evidenceCandidates: [], sideEffects: [], reconciliationRequired: true
    } as import('@co/contracts').ToolExecutionResult);
    expect((mockLedger.append as import("vitest").Mock).mock.calls[3][0].eventType).toBe('HOST_ACTION_RECONCILIATION_REQUIRED');
  });
});
