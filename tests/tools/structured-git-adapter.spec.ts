import { describe, it, expect } from 'vitest';
import { StructuredGitAdapter } from '@co/tools';

describe('StructuredGitAdapter Behavioral', () => {
  const reqBase = {
    schemaVersion: '1.0.0', requestId: '1', projectId: '1', actorRef: '1',
    workItemRef: '1', workPackageRef: '1', toolId: 'git',
    targetResource: 'file://', environment: 'LOCAL', authorityContextRef: '1',
    idempotencyKey: '1', correlationId: '1'
  };
  const policy = { requestId: '1', decision: 'ALLOW', reasonCode: 'ok', policyRefs: [], authorityRefs: [] };

  it('rejects arbitrary subcommands and uses --no-verify', async () => {
    const adapter = new StructuredGitAdapter('/tmp');

    // Unknown operation
    let res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.arbitrary', parameters: {} },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.status).toBe('FAILED');
    expect(res.summary).toContain('not allowed');

    // stage_paths only exact paths
    res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.stage_paths', parameters: { paths: ['a.txt', 'b.txt'] } },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.summary).toContain('git add -- a.txt b.txt');

    // commit uses --no-verify
    res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.commit', parameters: { message: 'msg' } },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.summary).toContain('git commit --no-verify -m msg');

    // push_main is non-force
    res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.push_main', parameters: {} },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.summary).toContain('git push --no-verify origin main');
    expect(res.summary).not.toContain('--force');

    // reject global add targets
    for (const badPath of ['.', '-A', '--all']) {
      res = await adapter.executeAuthorized({
        request: { ...reqBase, operationId: 'git.stage_paths', parameters: { paths: [badPath] } },
        policy
      } as import("@co/contracts").AuthorizedToolRequest);
      expect(res.status).toBe('FAILED');
      expect(res.summary).toContain('Broad stage paths are not allowed');
    }

    // reject empty paths
    res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.stage_paths', parameters: { paths: [] } },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.status).toBe('FAILED');
    expect(res.summary).toContain('paths array cannot be empty');

    // status, diff, show, rev-parse allowed
    for (const op of ['status', 'diff', 'show', 'rev-parse']) {
      res = await adapter.executeAuthorized({
        request: { ...reqBase, operationId: `git.${op}`, parameters: {} },
        policy
      } as import("@co/contracts").AuthorizedToolRequest);
      expect(res.status).not.toBe('DENIED'); // executed
    }
  });
});
