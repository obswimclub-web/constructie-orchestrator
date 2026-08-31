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

  it('rejects arbitrary subcommands', async () => {
    const adapter = new StructuredGitAdapter('/tmp');

    // Unknown operation
    let res = await adapter.executeAuthorized({
      request: { ...reqBase, operationId: 'git.arbitrary', parameters: {} },
      policy
    } as import("@co/contracts").AuthorizedToolRequest);
    expect(res.status).toBe('FAILED');
    expect(res.summary).toContain('not allowed');

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
  });

  // Since we have a real implementation for executeCommit and executePushMain,
  // we would mock child_process spawn in a full test, but for this bounded verification
  // we just test the guard rails and the status returned. 
  // We'll leave the actual commit/push integration tests for a dedicated test file if needed.
});


import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('StructuredGitAdapter V37 Lifecycle (Stage, Commit, Push)', () => {
    let repoPath: string;
    let adapter: StructuredGitAdapter;
    let baseSha: string;
    
    beforeAll(async () => {
        repoPath = path.join(process.cwd(), 'temp-repo-v37');
        try {
            fs.rmSync(repoPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
        fs.mkdirSync(repoPath, { recursive: true });
        execSync('git init --initial-branch=main', { cwd: repoPath });
        execSync('git config user.name "Test"', { cwd: repoPath });
        execSync('git config user.email "test@example.com"', { cwd: repoPath });
        fs.writeFileSync(path.join(repoPath, 'init.txt'), 'init');
        execSync('git add init.txt', { cwd: repoPath });
        execSync('git commit -m "Init"', { cwd: repoPath });
        baseSha = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
        
        adapter = new StructuredGitAdapter(repoPath);
    });

    afterAll(() => {
        try {
            fs.rmSync(repoPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    const wpA = 'wp-A';
    const wpB = 'wp-B';
    const policy = { requestId: 'test-1', decision: 'ALLOW', reasonCode: 'test', policyRefs: [], authorityRefs: [] } as unknown as import("@co/contracts").AuthorizedToolRequest;

    it('rejects cross-work-package claim substitution (WP-B reuses WP-A stage/commit)', async () => {
        // Stage in WP-A
        const filePath = path.join(repoPath, 'fileA.txt');
        fs.writeFileSync(filePath, 'A_staged');
        await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-stage-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idA', correlationId: 'corrA',
                toolId: 'git', operationId: 'git.stage_paths', targetResource: 'repo', environment: 'test',
                parameters: { paths: ['fileA.txt'] }
            }, policy
        });

        // 2. Commit WP-B trying to use WP-A's stageActionId
        const commitBRaceRes = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-B-steal-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpB,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCBsteal', correlationId: 'corrCBsteal',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit B', stageActionId: 'req-stage-A' }
            }, policy
        });
        expect(commitBRaceRes.status).toBe('FAILED');
        expect(commitBRaceRes.summary).toContain('Stage intent belongs to a different work package');

        // 3. Commit WP-A normally
        const commitARes = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCA', correlationId: 'corrCA',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit A', stageActionId: 'req-stage-A' }
            }, policy
        });
        expect(commitARes.status).toBe('SUCCEEDED');

        // 4. Push WP-B trying to use WP-A's commitActionId
        const pushBRaceRes = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-push-B-steal-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpB,
                authorityContextRef: 'ctx1', idempotencyKey: 'idPBsteal', correlationId: 'corrPBsteal',
                toolId: 'git', operationId: 'git.push_main', targetResource: 'repo', environment: 'test',
                parameters: { commitActionId: 'req-commit-A', expectedRemoteSha: baseSha }
            }, policy
        });
        expect(pushBRaceRes.status).toBe('FAILED');
        expect(pushBRaceRes.summary).toContain('Commit claim belongs to a different work package');
    });

    it('rejects idempotent replay bypass from a different work package', async () => {
        // 3. WP-B reuses already-completed commit action
        const commitARes_B = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpB,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCA2', correlationId: 'corrCA2',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit A', stageActionId: 'req-stage-A' }
            }, policy
        });
        expect(commitARes_B.status).toBe('FAILED');
        expect(commitARes_B.summary).toContain('Commit claim belongs to a different work package');
    });

    it('rejects when stage state is missing workPackageRef', async () => {
        const filePath = path.join(repoPath, 'fileC.txt');
        fs.writeFileSync(filePath, 'C_staged');
        const stageRes = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-stage-C', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idC', correlationId: 'corrC',
                toolId: 'git', operationId: 'git.stage_paths', targetResource: 'repo', environment: 'test',
                parameters: { paths: ['fileC.txt'] }
            }, policy
        });
        
        console.log("STAGE C RES:", stageRes);
        const stageCFile = path.join(repoPath, '.git', 'co-staging-req-stage-C.json');
        const stageCData = JSON.parse(fs.readFileSync(stageCFile, 'utf8'));
        delete stageCData.workPackageRef;
        fs.writeFileSync(stageCFile, JSON.stringify(stageCData));

        const commitCRes = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-C', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCC', correlationId: 'corrCC',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit C', stageActionId: 'req-stage-C' }
            }, policy
        });
        expect(commitCRes.status).toBe('FAILED');
        expect(commitCRes.summary).toContain('Stage intent belongs to a different work package');
    });

    it('rejects resume when commit claim is missing workPackageRef', async () => {
        const filePath = path.join(repoPath, 'fileD.txt');
        fs.writeFileSync(filePath, 'D_staged');
        await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-stage-D', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idD', correlationId: 'corrD',
                toolId: 'git', operationId: 'git.stage_paths', targetResource: 'repo', environment: 'test',
                parameters: { paths: ['fileD.txt'] }
            }, policy
        });
        await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-D', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCD', correlationId: 'corrCD',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit D', stageActionId: 'req-stage-D' }
            }, policy
        });

        const commitDFile = path.join(repoPath, '.git', 'co-action-req-commit-D.json');
        const commitDData = JSON.parse(fs.readFileSync(commitDFile, 'utf8'));
        const claim = commitDData.find((s: { type: string; workPackageRef?: string }) => s.type === 'COMMIT_OBJECT_CLAIMED');
        delete claim.workPackageRef;
        fs.writeFileSync(commitDFile, JSON.stringify(commitDData));

        const commitDRes2 = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-D', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCD2', correlationId: 'corrCD2',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit D', stageActionId: 'req-stage-D' }
            }, policy
        });
        expect(commitDRes2.status).toBe('FAILED');
        expect(commitDRes2.summary).toContain('Commit claim belongs to a different work package');
    });

    it('succeeds valid same-WP restart idempotently', async () => {
        const commitARes3 = await adapter.executeAuthorized({
            request: {
                schemaVersion: '1.0.0', requestId: 'req-commit-A', projectId: 'p1', actorRef: 'a1', workItemRef: 'w1', workPackageRef: wpA,
                authorityContextRef: 'ctx1', idempotencyKey: 'idCA3', correlationId: 'corrCA3',
                toolId: 'git', operationId: 'git.commit', targetResource: 'repo', environment: 'test',
                parameters: { message: 'Commit A', stageActionId: 'req-stage-A' }
            }, policy
        });
        expect(commitARes3.status).toBe('SUCCEEDED');
        expect(commitARes3.summary).toContain('Commit already executed and recorded');
    });
});
