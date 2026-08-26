import { describe, expect, it } from 'vitest';
import { ExecutionGateContext } from '@co/policy';

describe('ExecutionGateContext', () => {
  it('initializes with correct gate and environment', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'AUDIT', environment: 'LOCAL' });
    expect(ctx.gate).toBe('AUDIT');
    expect(ctx.environment).toBe('LOCAL');
  });

  it('starts with no authority tokens', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'COMMIT', environment: 'LOCAL' });
    expect(ctx.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
    expect(ctx.activeTokens).toHaveLength(0);
  });

  it('grants and reports authority tokens', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'COMMIT', environment: 'LOCAL' });
    ctx.grantAuthority('OWNER_COMMIT_APPROVED');
    expect(ctx.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);
  });

  it('revokes authority tokens', () => {
    const ctx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      initialTokens: ['OWNER_COMMIT_APPROVED'],
    });
    expect(ctx.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(true);
    ctx.revokeAuthority('OWNER_COMMIT_APPROVED');
    expect(ctx.hasAuthority('OWNER_COMMIT_APPROVED')).toBe(false);
  });

  it('transitions gates and records audit log', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'PLAN', environment: 'LOCAL' });
    ctx.transitionGate('IMPLEMENTATION');
    expect(ctx.gate).toBe('IMPLEMENTATION');
    const log = ctx.auditLog();
    expect(log.some((e) => e.event.includes('GATE_TRANSITION'))).toBe(true);
  });

  it('enforces file scope — approved file is approved', () => {
    const ctx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      approvedFileScope: ['packages/policy/src/index.ts', 'packages/policy/src/types.ts'],
    });
    expect(ctx.isFileApproved('packages/policy/src/index.ts')).toBe(true);
    expect(ctx.isFileApproved('packages/policy/src/types.ts')).toBe(true);
  });

  it('enforces file scope — unapproved file is rejected', () => {
    const ctx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      approvedFileScope: ['packages/policy/src/index.ts'],
    });
    expect(ctx.isFileApproved('packages/contracts/src/tool/contracts.ts')).toBe(false);
  });

  it('empty file scope means no files are approved', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'COMMIT', environment: 'LOCAL' });
    expect(ctx.isFileApproved('any/file.ts')).toBe(false);
  });

  it('setApprovedFileScope replaces previous scope', () => {
    const ctx = new ExecutionGateContext({
      initialGate: 'COMMIT',
      environment: 'LOCAL',
      approvedFileScope: ['old/file.ts'],
    });
    ctx.setApprovedFileScope(['new/file.ts']);
    expect(ctx.isFileApproved('old/file.ts')).toBe(false);
    expect(ctx.isFileApproved('new/file.ts')).toBe(true);
  });

  it('records all state changes in audit log', () => {
    const ctx = new ExecutionGateContext({ initialGate: 'PLAN', environment: 'LOCAL' });
    ctx.grantAuthority('OWNER_IMPLEMENTATION_APPROVED');
    ctx.transitionGate('IMPLEMENTATION');
    ctx.setApprovedFileScope(['src/foo.ts']);
    ctx.revokeAuthority('OWNER_IMPLEMENTATION_APPROVED');

    const log = ctx.auditLog();
    expect(log.some((e) => e.event.includes('AUTHORITY_GRANTED'))).toBe(true);
    expect(log.some((e) => e.event.includes('GATE_TRANSITION'))).toBe(true);
    expect(log.some((e) => e.event.includes('FILE_SCOPE_SET'))).toBe(true);
    expect(log.some((e) => e.event.includes('AUTHORITY_REVOKED'))).toBe(true);
  });
});
