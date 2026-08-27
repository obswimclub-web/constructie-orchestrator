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
  private activeProcesses = new Map<string, ChildProcess>();
  private activeResults = new Map<string, Promise<AgentRunResult>>();
  private activeIpcServers = new Map<string, PerRunIpcServer>();

  constructor(
    private readonly gatewayFactory: (attemptId: string) => GovernedToolGateway,
    private readonly redactor: OutputRedactor
  ) {}

  public async dispatch(workPackage: WorkPackage, context: AgentRuntimeContext): Promise<AgentRunHandle> {
    const runId = context.workflowRunId;
    const runRef = { runId };
    const attemptId = context.attemptId;
    if (this.activeIpcServers.has(attemptId)) {
      throw new Error(`Duplicate host session for attempt: ${attemptId}`);
    }

    const gateway = this.gatewayFactory(context.attemptId);
    const ipcServer = new PerRunIpcServer(context, gateway, this.redactor, workPackage);
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

        try {
          const parsed = JSON.parse(stdoutData);
          if (parsed.error) {
            return resolve(this.createFailedResult(runRef, parsed.error));
          }
          const validated = AgentRunResultSchema.parse(parsed);
          validated.summary = this.redactor ? this.redactor.redact(validated.summary) : validated.summary;
          resolve(validated);
        } catch (e) {
          resolve(this.createFailedResult(runRef, `Invalid JSON or output from Python: ${e instanceof Error ? e.message : String(e)}`));
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

    const payload = JSON.stringify({ workPackage, context });
    child.stdin.write(payload);
    child.stdin.end();

    return { ...runRef, status: 'RUNNING' };
  }

  public async getStatus(runRef: AgentRunRef): Promise<AgentRunStatus> {
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
    const child = this.activeProcesses.get(runRef.runId);
    if (!child) return;

    child.kill('SIGTERM');

    await new Promise((res) => setTimeout(res, 2000));
    if (this.activeProcesses.has(runRef.runId)) {
      child.kill('SIGKILL');
    }
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
      evidence: [],
      unresolvedItems: [],
      requestedInputs: [],
      sideEffects: [],
      usage: { inputUnits: 0, outputUnits: 0, estimatedCost: 0, currency: 'USD' },
    };
  }
}
