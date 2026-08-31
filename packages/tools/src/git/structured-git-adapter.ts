/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn } from 'child_process';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { ToolAdapter, ToolExecutionResult } from '@co/contracts';
import { AuthorizedToolRequestSchema, ToolExecutionResultSchema, type AuthorizedToolRequest } from '@co/contracts';

const ALLOWED_OPERATIONS = ['status', 'diff', 'show', 'rev-parse', 'stage_paths', 'commit', 'push_main'];

export class StructuredGitAdapter implements ToolAdapter {
  public readonly toolId = 'git';
  public readonly description = 'Structured git operations. No arbitrary args. Shell bypassed.';

  constructor(private readonly repoCwd: string) {}

  public async executeAuthorized(request: AuthorizedToolRequest): Promise<ToolExecutionResult> {
    const parsed = AuthorizedToolRequestSchema.parse(request);
    const { operationId, parameters } = parsed.request;

    // e.g. git.status -> status
    const op = operationId.replace('git.', '');

    if (!ALLOWED_OPERATIONS.includes(op)) {
      return this.fail(parsed.request.requestId, `Git operation '${op}' not allowed.`);
    }

    let args: string[] = [];
    switch (op) {
      case 'status':
        args = ['status', '--short'];
        break;
      case 'diff':
        args = ['diff'];
        break;
      case 'show':
        args = ['show'];
        break;
      case 'rev-parse':
        args = ['rev-parse', 'HEAD'];
        break;
      case 'stage_paths': {
        if (!Array.isArray(parameters.paths)) return this.fail(parsed.request.requestId, 'stage_paths requires paths array');
        if (parameters.paths.length === 0) return this.fail(parsed.request.requestId, 'paths array cannot be empty');
        const p = parameters.paths as string[];
        for (const pp of p) {
          if (pp === '.' || pp === '-A' || pp === '--all') return this.fail(parsed.request.requestId, 'Broad stage paths are not allowed');
        }
        return await this.executeStagePaths(parsed.request.requestId, parsed.request.workPackageRef, p);
        }
      case 'commit':
        if (typeof parameters.message !== 'string') return this.fail(parsed.request.requestId, 'commit requires message');
        return await this.executeCommit(parsed.request.requestId, parsed.request.workPackageRef, parameters.message as string, parameters.stageActionId as string);
      case 'push_main':
        return await this.executePushMain(parsed.request.requestId, parsed.request.workPackageRef, (parameters.expectedRemoteSha as string) || '', (parameters.commitActionId as string) || '');
      default:
        return this.fail(parsed.request.requestId, `Unhandled operation: ${op}`);
    }

    try {
      const { stdout, stderr, code } = await this.spawnGit(args);
      const isError = code !== 0;
      return ToolExecutionResultSchema.parse({
        schemaVersion: '1.0.0',
        executionId: `git-${Date.now()}`,
        requestId: parsed.request.requestId,
        toolId: this.toolId,
        operationId: parsed.request.operationId,
        status: isError ? 'FAILED' : 'SUCCEEDED',
        summary: `git ${args.join(' ')}\nExit code: ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: ['stage_paths', 'commit', 'push_main'].includes(op) ? [`Executed git ${op}`] : [],
        reconciliationRequired: false,
      });
    } catch (err) {
      return this.fail(parsed.request.requestId, `Execution threw: ${err instanceof Error ? (err as Error).message : String(err)}`);
    }
  }

  
  private async executeStagePaths(requestId: string, workPackageRef: string, paths: string[]): Promise<ToolExecutionResult> {
    try {
      const actionId = requestId;
      const stagingFile = path.join(this.repoCwd, '.git', `co-staging-${actionId}.json`);
      const tempIndex = path.join(this.repoCwd, '.git', `co-index-${actionId}`);
      
      const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
      
      let sourceSha = '';
      let approvedPaths: string[] = [];
      try {
        const data = await fsPromises.readFile(stagingFile, 'utf8');
        const parsed = JSON.parse(data);
        sourceSha = parsed.sourceSha || '';
        approvedPaths = parsed.approvedPaths || [];
      } catch { /* ignore */ }

      try {
        await fsPromises.access(tempIndex);
      } catch {
        const { stdout: headSha } = await this.spawnGitCmd(['rev-parse', 'HEAD'], this.repoCwd);
        sourceSha = headSha.trim();
        await this.spawnGitCmd(['read-tree', sourceSha], this.repoCwd, env);
      }
      
      if (paths.length > 0) {
        await this.spawnGitCmd(['add', '--', ...paths], this.repoCwd, env);
        approvedPaths = Array.from(new Set([...approvedPaths, ...paths]));
      }
      
      const { stdout: treeShaOut } = await this.spawnGitCmd(['write-tree'], this.repoCwd, env);
      const stagedTreeSha = treeShaOut.trim();
      
      await fsPromises.writeFile(stagingFile, JSON.stringify({ stagedTreeSha, sourceSha, approvedPaths, workPackageRef }), 'utf8');

      return ToolExecutionResultSchema.parse({
        schemaVersion: '1.0.0',
        executionId: `git-${Date.now()}`,
        requestId,
        toolId: this.toolId,
        operationId: 'git.stage_paths',
        status: 'SUCCEEDED',
        summary: `Staged paths virtually for isolated tree generation: ${paths.join(' ')}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [`Executed git stage_paths virtually`],
        reconciliationRequired: false,
      });
    } catch (err: unknown) {
      return this.fail(requestId, `Stage failed: ${(err as Error).message}`);
    }
  }

  private async readActionState(actionId: string): Promise<any[]> {
    try {
      const statePath = path.join(this.repoCwd, '.git', `co-action-${actionId}.json`);
      const data = await fsPromises.readFile(statePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async appendActionState(actionId: string, state: any): Promise<void> {
    const existing = await this.readActionState(actionId);
    existing.push(state);
    const statePath = path.join(this.repoCwd, '.git', `co-action-${actionId}.json`);
    await fsPromises.writeFile(statePath, JSON.stringify(existing, null, 2));
  }

  private async executeCommit(requestId: string, workPackageRef: string, message: string, stageActionId: string): Promise<ToolExecutionResult> {
    try {
      const actionId = requestId;
      
      const existingState = await this.readActionState(actionId);
      
      const claim = existingState.find(s => s.type === 'COMMIT_OBJECT_CLAIMED');
      if (claim) {
          if (!claim.workPackageRef || claim.workPackageRef !== workPackageRef) {
              throw new Error('Commit claim belongs to a different work package: ' + claim.workPackageRef);
          }
      }

      if (existingState.some(s => s.type === 'COMMIT_OUTPUT_RECORDED')) {
        return {
          schemaVersion: '1.0.0',
          executionId: `git-${Date.now()}`,
          requestId,
          toolId: this.toolId,
          operationId: 'git.commit',
          status: 'SUCCEEDED',
          summary: 'Commit already executed and recorded.',
          artifacts: [],
          evidenceCandidates: [],
          sideEffects: [],
          reconciliationRequired: false
        };
      }

      let binding = claim;
      let sourceSha = '';
      if (binding) {
        sourceSha = binding.sourceSha;
      }

      if (!binding) {
        let stagedTreeSha = '';
        let approvedPaths: string[] = [];
        if (!stageActionId) throw new Error('Missing explicit stageActionId for commit staging resolution');
        const stagingFile = path.join(this.repoCwd, '.git', `co-staging-${stageActionId}.json`);
        
        try {
          const data = await fsPromises.readFile(stagingFile, 'utf8');
          const parsed = JSON.parse(data);
          if (!parsed.stagedTreeSha || !parsed.sourceSha) throw new Error('Invalid staging state format: missing stagedTreeSha or sourceSha');
          stagedTreeSha = parsed.stagedTreeSha;
          sourceSha = parsed.sourceSha;
          approvedPaths = parsed.approvedPaths || [];
          if (!parsed.workPackageRef || parsed.workPackageRef !== workPackageRef) {
              throw new Error('Stage intent belongs to a different work package: ' + parsed.workPackageRef);
          }
        } catch (e) { 
          throw new Error('Failed to resolve durable stage intent: ' + (e as Error).message);
        }

        const { stdout: headShaOut } = await this.spawnGitCmd(['rev-parse', 'HEAD'], this.repoCwd);
        if (headShaOut.trim() !== sourceSha) {
          throw new Error('Branch moved concurrently. Current HEAD no longer matches the stage-time base.');
        }

        const isolatedRepo = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'git-isolation-'));
        await this.spawnGitCmd(['init', '--bare', isolatedRepo], process.cwd());
        
        const alternatesPath = path.join(isolatedRepo, 'objects', 'info', 'alternates');
        await fsPromises.mkdir(path.dirname(alternatesPath), { recursive: true });
        await fsPromises.writeFile(
          alternatesPath, 
          path.join(this.repoCwd, '.git', 'objects')
        );

        const actionTimestampIso = process.env.CO_AUTHOR_DATE || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        
        const generativeEnv = {
          ...process.env,
          GIT_DIR: isolatedRepo,
          GIT_WORK_TREE: this.repoCwd,
          GIT_AUTHOR_NAME: process.env.CO_AUTHOR_NAME || 'Co-Agent',
          GIT_AUTHOR_EMAIL: process.env.CO_AUTHOR_EMAIL || 'agent@co',
          GIT_AUTHOR_DATE: actionTimestampIso,
          GIT_COMMITTER_NAME: process.env.CO_AUTHOR_NAME || 'Co-Agent',
          GIT_COMMITTER_EMAIL: process.env.CO_AUTHOR_EMAIL || 'agent@co',
          GIT_COMMITTER_DATE: actionTimestampIso,
        };
        
        // 4. commit-tree
        const { stdout: commitShaOut } = await this.spawnGitCmd(['commit-tree', stagedTreeSha, '-p', sourceSha, '-m', message], isolatedRepo, generativeEnv);
        const commitSha = commitShaOut.trim();

        // 5. tempRef
        const tempRef = `refs/co-actions/${actionId}/candidate`;
        await this.spawnGitCmd(['update-ref', tempRef, commitSha], isolatedRepo, generativeEnv);

        // 6. bundle create
        const bundleArtifactPath = path.join(isolatedRepo, 'generation.bundle');
        await this.spawnGitCmd(['bundle', 'create', bundleArtifactPath, tempRef, `^${sourceSha}`], isolatedRepo, generativeEnv);
        
        await this.spawnGitCmd(['bundle', 'verify', bundleArtifactPath], isolatedRepo, generativeEnv);
        
        const bundleData = await fsPromises.readFile(bundleArtifactPath);
        const bundleDigest = crypto.createHash('sha256').update(bundleData).digest('hex');

        binding = {
          type: 'COMMIT_OBJECT_CLAIMED',
          actionId,
          commitSha,
          expectedStagedTreeSha: stagedTreeSha,
          authorDate: actionTimestampIso,
          bundleArtifactPath,
          bundleDigest,
          bundleRef: tempRef,
          sourceSha,
          approvedPaths,
          workPackageRef
        };
        
        await this.appendActionState(actionId, binding);
      }

      if (!existingState.some(s => s.type === 'IMPORT_VERIFIED')) {
        const bundleData = await fsPromises.readFile(binding!.bundleArtifactPath);
        const digest = crypto.createHash('sha256').update(bundleData).digest('hex');
        if (digest !== binding!.bundleDigest) {
            throw new Error('Bundle checksum validation failed! Possible tampering.');
        }

        await this.spawnGitCmd(['fetch', '--no-write-fetch-head', binding!.bundleArtifactPath, binding!.bundleRef], this.repoCwd);
        
        const targetSha = claim ? claim.commitSha : binding!.commitSha;
        const { stdout: producedTree } = await this.spawnGitCmd(['log', '-1', '--format=%T', targetSha], this.repoCwd);
        if (producedTree.trim() !== binding!.expectedStagedTreeSha) {
            throw new Error('Tree deterministic violation');
        }
        const { stdout: producedAuthorDate } = await this.spawnGitCmd(['log', '-1', '--format=%ad', '--date=iso-strict', targetSha], this.repoCwd);
        if (producedAuthorDate.trim().replace('+00:00', 'Z') !== binding!.authorDate.replace('+00:00', 'Z')) {
            throw new Error(`Timestamp deterministic violation: ${producedAuthorDate.trim()} !== ${binding!.authorDate}`);
        }

        await this.appendActionState(binding!.actionId, { type: 'IMPORT_VERIFIED', actionId: binding!.actionId });
      }

      if (!existingState.some(s => s.type === 'REF_CAS_VERIFIED')) {
         try {
             const targetSha = claim ? claim.commitSha : binding!.commitSha;
             const baseSha = claim ? claim.sourceSha : binding!.sourceSha;
             // Use update-ref instead of reset --hard
             await this.spawnGitCmd(['update-ref', 'refs/heads/main', targetSha, baseSha], this.repoCwd);
             await this.appendActionState(binding!.actionId, { type: 'REF_CAS_VERIFIED', actionId: binding!.actionId });
         } catch {
             await this.appendActionState(binding!.actionId, { type: 'LINEAGE_STALE_DRIFT', actionId: binding!.actionId });
             throw new Error('Branch moved concurrently. CAS failed.');
         }
      }

      await this.appendActionState(binding!.actionId, { type: 'COMMIT_OUTPUT_RECORDED', actionId: binding!.actionId });

      return ToolExecutionResultSchema.parse({
        schemaVersion: '1.0.0',
        executionId: `git-${Date.now()}`,
        requestId,
        toolId: this.toolId,
        operationId: 'git.commit',
        status: 'SUCCEEDED',
        summary: `git commit --no-verify -m ${message}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [`Git commit created ${binding!.commitSha}`],
        reconciliationRequired: false
      });
    } catch (err: unknown) {
      return this.fail(requestId, `Commit failed: ${(err as Error).message}`);
    }
  }

  private async executePushMain(requestId: string, workPackageRef: string, expectedRemoteSha: string, commitActionId: string): Promise<ToolExecutionResult> {
    try {
      if (!commitActionId) return this.fail(requestId, 'push_main requires an explicit commitActionId to bind to the verified candidate');
      const existingState = await this.readActionState(commitActionId);
      const claim = existingState.find(s => s.type === 'COMMIT_OBJECT_CLAIMED');
      if (!claim || !claim.commitSha) {
          return this.fail(requestId, 'No durable claim found for push_main. Refusing to push a mutable HEAD.');
      }
      if (!claim.workPackageRef || claim.workPackageRef !== workPackageRef) {
          return this.fail(requestId, 'Commit claim belongs to a different work package: ' + claim.workPackageRef);
      }
      const candidateSha = claim.commitSha;

      const { stdout: remoteLs } = await this.spawnGitCmd(['ls-remote', 'origin', 'refs/heads/main'], this.repoCwd);
      const actualRemoteSha = (remoteLs.split('\t')[0] || '').trim();
      
      if (actualRemoteSha !== expectedRemoteSha) {
          return this.fail(requestId, `Remote destination (${actualRemoteSha}) differs from grant-bound expectedRemoteSha (${expectedRemoteSha}). Refusing to push.`);
      }

      try {
        const { stdout: mergeBaseSha } = await this.spawnGitCmd(['merge-base', candidateSha, expectedRemoteSha], this.repoCwd);
        if (mergeBaseSha.trim() !== expectedRemoteSha) {
          throw new Error('Not fast-forward');
        }
      } catch {
        return this.fail(requestId, 'Proposed push is non-fast-forward. Refusing to rewrite history without explicit GRANT_HISTORY_REWRITE.');
      }

      try {
        await this.spawnGitCmd(['push', 'origin', `${candidateSha}:refs/heads/main`], this.repoCwd);
      } catch (err: unknown) {
        return ToolExecutionResultSchema.parse({
          schemaVersion: '1.0.0',
          executionId: `git-${Date.now()}`,
          requestId,
          toolId: this.toolId,
          operationId: 'git.push_main',
          status: 'FAILED',
          summary: 'Push rejected. Entering reconciliation. ' + (err as Error).message,
          artifacts: [],
          evidenceCandidates: [],
          sideEffects: [],
          reconciliationRequired: true
        });
      }
      
      const { stdout: postRemoteLs } = await this.spawnGitCmd(['ls-remote', 'origin', 'refs/heads/main'], this.repoCwd);
      const postActualRemoteSha = (postRemoteLs.split('\t')[0] || '').trim();
      if (postActualRemoteSha !== candidateSha) {
          return this.fail(requestId, 'Remote destination did not adopt the exact candidate SHA. Entering reconciliation.');
      }

      return ToolExecutionResultSchema.parse({
        schemaVersion: '1.0.0',
        executionId: `git-${Date.now()}`,
        requestId,
        toolId: this.toolId,
        operationId: 'git.push_main',
        status: 'SUCCEEDED',
        summary: `git push origin ${candidateSha}:refs/heads/main`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [`Git pushed exact candidate ${candidateSha} to origin main`],
        reconciliationRequired: false
      });
    } catch (err: unknown) {
      return this.fail(requestId, `Push failed: ${(err as Error).message}`);
    }
  }

  private spawnGitCmd(args: string[], cwd: string, env: any = process.env): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        shell: false,
        env: { ...env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.stderr.on('data', (c) => (stderr += c));
      child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
      child.on('error', reject);
    });
  }

  private spawnGit(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.repoCwd,
        shell: false,
        env: { ...process.env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.stderr.on('data', (c) => (stderr += c));
      child.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? 1 });
      });
      child.on('error', reject);
    });
  }

  private fail(requestId: string, reason: string): ToolExecutionResult {
    return ToolExecutionResultSchema.parse({
      schemaVersion: '1.0.0',
      executionId: `git-fail-${Date.now()}`,
      requestId,
      toolId: this.toolId,
      operationId: 'unknown',
      status: 'FAILED',
      summary: reason,
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
      reconciliationRequired: false,
    });
  }
}
