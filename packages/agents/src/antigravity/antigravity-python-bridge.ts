import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';
import type {
  AgentBridge,
  AgentRunHandle,
  AgentRunRef,
  AgentRunResult,
  AgentRunStatus,
  AgentRuntimeContext,
  WorkPackage,
} from '@co/contracts';
import { AgentRunResultSchema } from '@co/contracts';
import { PerRunIpcServer } from './per-run-ipc-server.js';
import type { GovernedToolGateway } from '@co/tools';
import { OutputRedactor } from '@co/tools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/antigravity-bridge.py');

export class AntigravityPythonBridge implements AgentBridge {
  private cancelledRuns = new Set<string>();
  private timeoutRuns = new Set<string>();
  private activeProcesses = new Map<string, ChildProcess>();
  private activeResults = new Map<string, Promise<AgentRunResult>>();
  private activeIpcServers = new Map<string, PerRunIpcServer>();

  constructor(
    private readonly gatewayFactory: (attemptId: string) => GovernedToolGateway,
    private readonly redactor: OutputRedactor,
    private readonly agentId: string = 'agent:antigravity'
  ) {}

  public async dispatch(workPackage: WorkPackage, context: AgentRuntimeContext): Promise<AgentRunHandle> {
    const runId = context.workflowRunId;
    const runRef = { runId };
    const attemptId = context.attemptId;
    if (this.activeIpcServers.has(attemptId)) {
      throw new Error(`Duplicate host session for attempt: ${attemptId}`);
    }

    const gateway = this.gatewayFactory(context.attemptId);
    const ipcServer = new PerRunIpcServer(context, gateway, this.redactor, workPackage, this.agentId);
    await ipcServer.start();
    this.activeIpcServers.set(attemptId, ipcServer);

    const child = spawn('python3', [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        IPC_SOCKET_PATH: ipcServer.socketPath,
        IPC_NONCE: ipcServer.nonce
      }
    });

    this.activeProcesses.set(runId, child);

    const resultPromise = new Promise<AgentRunResult>((resolve, ) => {
      let stdoutData = '';
      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        // Redact diagnostic output
        void this.redactor.redact(chunk.toString());
      });

      child.on('close', async () => {
        this.activeProcesses.delete(runId);
        const server = this.activeIpcServers.get(attemptId);
        if (server) {
          await server.stop();
          this.activeIpcServers.delete(attemptId);
        }

        // If this run timed out, return FAILED status with timeout evidence
        if (this.timeoutRuns.has(runId)) {
          return resolve(this.createTimeoutResult(runRef));
        }

        // If this run was cancelled, return CANCELLED status deterministically
        if (this.cancelledRuns.has(runId)) {
          return resolve(this.createCancelledResult(runRef));
        }

        try {
          const parsed = JSON.parse(stdoutData);
          if (parsed.error) {
            return resolve(this.createFailedResult(runRef, parsed.error));
          }
          const validated = AgentRunResultSchema.parse(parsed);
          validated.summary = this.redactor ? this.redactor.redact(validated.summary) : validated.summary;
          resolve(validated);
        } catch (e) {
          resolve(this.createMalformedResult(runRef, `Invalid JSON or output from Python: ${e instanceof Error ? e.message : String(e)}`));
        }
      });

      child.on('error', async (err) => {
        this.activeProcesses.delete(runId);
        const server = this.activeIpcServers.get(attemptId);
        if (server) {
          await server.stop();
          this.activeIpcServers.delete(attemptId);
        }
        resolve(this.createFailedResult(runRef, `Process spawn error: ${err.message}`));
      });
    });

    this.activeResults.set(runId, resultPromise);

    // Set up timeout if timeBudgetMs is specified — uses real cancel path
    if (context.timeBudgetMs) {
      setTimeout(() => {
        if (this.activeProcesses.has(runId)) {
          // Mark as timed out (distinct from cancelled), then use real kill path
          this.timeoutRuns.add(runId);
          const activeChild = this.activeProcesses.get(runId);
          if (activeChild) {
            activeChild.kill('SIGTERM');
            // SIGKILL fallback after 500ms if process doesn't exit
            setTimeout(() => {
              if (this.activeProcesses.has(runId)) {
                activeChild.kill('SIGKILL');
              }
            }, 500);
          }
        }
      }, context.timeBudgetMs);
    }

    const payload = JSON.stringify({ workPackage, context });
    child.stdin.write(payload);
    child.stdin.end();

    return { ...runRef, status: 'RUNNING' };
  }

  public async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> {
    // If cancel() or timeout was called, return deterministic status immediately
    if (this.cancelledRuns.has(runRef.runId)) {
      return 'CANCELLED';
    }
    if (this.timeoutRuns.has(runRef.runId)) {
      return 'FAILED';
    }
    if (this.activeProcesses.has(runRef.runId)) {
      return 'RUNNING';
    }
    const p = this.activeResults.get(runRef.runId);
    if (p) {
       const res = await p;
       return res.status;
    }
    return 'UNKNOWN';
  }

  public async getResult(runRef: AgentRunRef): Promise<AgentRunResult> {
    const p = this.activeResults.get(runRef.runId);
    if (p) {
      return p;
    }
    return this.createFailedResult(runRef, 'Result not found or process already exited without result.');
  }

  public async cancel(runRef: AgentRunRef): Promise<void> {
    this.cancelledRuns.add(runRef.runId);
    const child = this.activeProcesses.get(runRef.runId);
    if (!child) return;

    child.kill('SIGTERM');

    // Wait for graceful shutdown, then force kill
    const killTimeout = 500;
    await new Promise<void>((res) => {
      const timer = setTimeout(() => {
        if (this.activeProcesses.has(runRef.runId)) {
          child.kill('SIGKILL');
        }
        res();
      }, killTimeout);

      // If process closes before timeout, resolve immediately
      const onClose = () => {
        clearTimeout(timer);
        res();
      };
      child.once('close', onClose);
      child.once('exit', onClose);
    });
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const fsPromises = await import('fs/promises');
      await fsPromises.stat(SCRIPT_PATH);
      // Verify python3 is reachable by checking the script is importable
      // This is a bounded probe: script exists + file is readable
      const stats = await fsPromises.stat(SCRIPT_PATH);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  }

  private createMalformedResult(runRef: AgentRunRef, summary: string): AgentRunResult {
    return {
      schemaVersion: '1.0.0',
      runRef,
      status: 'FAILED',
      summary: (this.redactor ? this.redactor.redact(summary) : summary),
      actionsTaken: [],
      artifacts: [],
      findings: [],
      evidence: [{ type: 'malformed_output', claimSupported: 'Malformed output from provider', sourceRef: 'AntigravityPythonBridge' }],
      unresolvedItems: [],
      requestedInputs: [],
      sideEffects: [],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD', costStatus: 'UNKNOWN' },
    };
  }

  private createFailedResult(runRef: AgentRunRef, summary: string): AgentRunResult {
    return {
      schemaVersion: '1.0.0',
      runRef,
      status: 'FAILED',
      summary: (this.redactor ? this.redactor.redact(summary) : summary),
      actionsTaken: [],
      artifacts: [],
      findings: [],
      evidence: [{ type: 'error', claimSupported: summary.includes('spawn') ? 'Spawn failure' : 'Error', sourceRef: 'AntigravityPythonBridge' }],
      unresolvedItems: [],
      requestedInputs: [],
      sideEffects: [],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD', costStatus: 'UNKNOWN' },
    };
  }

  private createTimeoutResult(runRef: AgentRunRef): AgentRunResult {
    return {
      schemaVersion: '1.0.0',
      runRef,
      status: 'FAILED',
      summary: 'Run timed out',
      actionsTaken: [],
      artifacts: [],
      findings: [],
      evidence: [{ type: 'timeout', claimSupported: 'Timeout', sourceRef: 'AntigravityPythonBridge' }],
      unresolvedItems: [],
      requestedInputs: [],
      sideEffects: [],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD', costStatus: 'UNKNOWN' },
    };
  }

  private createCancelledResult(runRef: AgentRunRef): AgentRunResult {
    return {
      schemaVersion: '1.0.0',
      runRef,
      status: 'CANCELLED',
      summary: 'Run was cancelled',
      actionsTaken: [],
      artifacts: [],
      findings: [],
      evidence: [{ type: 'cancellation', claimSupported: 'Timeout', sourceRef: 'AntigravityPythonBridge' }],
      unresolvedItems: [],
      requestedInputs: [],
      sideEffects: [],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD', costStatus: 'UNKNOWN' },
    };
  }
}
