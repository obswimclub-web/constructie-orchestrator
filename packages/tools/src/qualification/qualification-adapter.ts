import { spawn } from 'child_process';
import type { ToolAdapter, ToolExecutionResult } from '@co/contracts';
import { AuthorizedToolRequestSchema, ToolExecutionResultSchema, type AuthorizedToolRequest } from '@co/contracts';

export class QualificationAdapter implements ToolAdapter {
  public readonly toolId = 'qualification';
  public readonly description = 'Runs the repository canonical pnpm qualification. No shell.';

  constructor(private readonly repoCwd: string) {}

  public async executeAuthorized(request: AuthorizedToolRequest): Promise<ToolExecutionResult> {
    const parsed = AuthorizedToolRequestSchema.parse(request);

    if (parsed.request.operationId !== 'qualification.run') {
      return this.fail(parsed.request.requestId, `Qualification operation '${parsed.request.operationId}' not allowed.`);
    }

    try {
      const { stdout, stderr, code } = await this.spawnQualification();
      const isError = code !== 0;
      return ToolExecutionResultSchema.parse({
        schemaVersion: '1.0.0',
        executionId: `qual-${Date.now()}`,
        requestId: parsed.request.requestId,
        toolId: this.toolId,
        operationId: parsed.request.operationId,
        status: isError ? 'FAILED' : 'SUCCEEDED',
        summary: `pnpm qualification\nExit code: ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        artifacts: [],
        evidenceCandidates: [],
        sideEffects: [],
        reconciliationRequired: false,
      });
    } catch (err) {
      return this.fail(parsed.request.requestId, `Execution threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private spawnQualification(): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['qualification'], {
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
      executionId: `qual-fail-${Date.now()}`,
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
