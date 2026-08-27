import { describe, it, expect } from 'vitest';
import { QualificationAdapter } from '@co/tools';

describe('QualificationAdapter Behavioral', () => {
  const reqBase = {
    schemaVersion: '1.0.0', requestId: '1', projectId: '1', actorRef: '1',
    workItemRef: '1', workPackageRef: '1', toolId: 'qualification',
    targetResource: 'file://', environment: 'LOCAL', authorityContextRef: '1',
    idempotencyKey: '1', correlationId: '1'
  };
  const policy = { requestId: '1', decision: 'ALLOW', reasonCode: 'ok', policyRefs: [], authorityRefs: [] };

  it('only exact qualification operation accepted, arbitrary rejected', async () => {
    const adapter = new QualificationAdapter('/tmp');

    let res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'arbitrary', parameters: {} },
      policy
    } as unknown as import("@co/contracts").AuthorizedToolRequest);

    expect(res.status).toBe('FAILED');
    expect(res.summary).toContain('Qualification operation \'arbitrary\' not allowed');

    res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'qualification.run', parameters: {} },
      policy
    } as unknown as import("@co/contracts").AuthorizedToolRequest);

    expect(res.summary).toContain('pnpm qualification');
    expect(res.summary).not.toContain('arbitrary');
  });
});
