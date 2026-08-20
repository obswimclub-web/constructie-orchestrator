import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
  type AuthorizedToolRequest,
  type ToolAdapter,
  type ToolExecutionResult,
} from '@co/contracts';

export class SandboxPathViolationError extends Error {
  public readonly code = 'SANDBOX_PATH_VIOLATION';
  public constructor(public readonly requestedPath: string) {
    super(`Requested path is outside allowed sandbox roots: ${requestedPath}`);
    this.name = 'SandboxPathViolationError';
  }
}

export class SandboxOperationNotSupportedError extends Error {
  public readonly code = 'SANDBOX_OPERATION_NOT_SUPPORTED';
}

export class SandboxFilesystemAdapter implements ToolAdapter {
  public readonly toolId = 'sandbox-filesystem';
  private readonly roots: string[];

  public constructor(allowedRoots: readonly string[]) {
    this.roots = allowedRoots.map((root) => resolve(root));
  }

  public async executeAuthorized(input: AuthorizedToolRequest): Promise<ToolExecutionResult> {
    const operation = input.request.operationId;
    const pathValue = input.request.parameters.path;
    if (typeof pathValue !== 'string') throw new TypeError('Sandbox filesystem operation requires string parameter "path".');
    const absolutePath = this.assertAllowedPath(pathValue);

    if (operation === 'filesystem.read') {
      const content = await readFile(absolutePath, 'utf8');
      return this.result(input, 'SUCCEEDED', `Read ${absolutePath}`, undefined, [{
        artifactId: randomUUID(), type: 'FILE_CONTENT', ref: `inline:text:${encodeURIComponent(content)}`,
      }]);
    }

    if (operation === 'filesystem.write') {
      const content = input.request.parameters.content;
      if (typeof content !== 'string') throw new TypeError('filesystem.write requires string parameter "content".');
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
      return this.result(input, 'SUCCEEDED', `Wrote ${absolutePath}`, `file:${absolutePath}`, [], [`WRITE:${absolutePath}`]);
    }

    throw new SandboxOperationNotSupportedError(`Unsupported operation: ${operation}`);
  }

  private assertAllowedPath(inputPath: string): string {
    const candidate = resolve(inputPath);
    const allowed = this.roots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`));
    if (!allowed) throw new SandboxPathViolationError(inputPath);
    return candidate;
  }

  private result(
    input: AuthorizedToolRequest,
    status: 'SUCCEEDED' | 'FAILED',
    summary: string,
    observedEffect?: string,
    artifacts: ToolExecutionResult['artifacts'] = [],
    sideEffects: string[] = [],
  ): ToolExecutionResult {
    return {
      schemaVersion: TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
      executionId: randomUUID(),
      requestId: input.request.requestId,
      toolId: this.toolId,
      operationId: input.request.operationId,
      status,
      summary,
      observedEffect,
      artifacts,
      evidenceCandidates: [],
      sideEffects,
      reconciliationRequired: false,
    };
  }
}
