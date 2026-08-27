import { spawn } from 'child_process';
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
      case 'stage_paths':
        if (!Array.isArray(parameters.paths)) {
          return this.fail(parsed.request.requestId, 'stage_paths requires paths array');
        }
        if (parameters.paths.length === 0) {
          return this.fail(parsed.request.requestId, 'paths array cannot be empty');
        }
        for (const p of parameters.paths as string[]) {
          if (p === '.' || p === '-A' || p === '--all') {
            return this.fail(parsed.request.requestId, 'Broad stage paths are not allowed');
          }
        }
        // Force exactly the validated paths, NO broad staging
        args = ['add', '--', ...(parameters.paths as string[])];
        break;
      case 'commit':
        if (typeof parameters.message !== 'string') {
          return this.fail(parsed.request.requestId, 'commit requires message');
        }
        // No hook execution
        args = ['commit', '--no-verify', '-m', parameters.message];
        break;
      case 'push_main':
        // Explicitly hardcoded remote/branch
        args = ['push', '--no-verify', 'origin', 'main'];
        break;
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
      return this.fail(parsed.request.requestId, `Execution threw: ${err instanceof Error ? err.message : String(err)}`);
    }
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
