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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/antigravity-bridge.py');

export class AntigravityPythonBridge implements AgentBridge {
  private activeProcesses = new Map<string, ChildProcess>();
  private activeResults = new Map<string, Promise<AgentRunResult>>();

  public async dispatch(workPackage: WorkPackage, context: AgentRuntimeContext): Promise<AgentRunHandle> {
    const runId = context.workflowRunId;
    const runRef = { runId };

    const child = spawn('python3', [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.activeProcesses.set(runId, child);

    const resultPromise = new Promise<AgentRunResult>((resolve, _reject) => {
      void _reject;
      let stdoutData = '';

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on('data', (_chunk) => {
        void _chunk;
        // Logs/thoughts streaming
        // console.error(`[PY-BRIDGE] ${chunk.toString().trim()}`);
      });

      child.on('close', (_code) => {
        void _code;
        this.activeProcesses.delete(runId);
        try {
          const parsed = JSON.parse(stdoutData);
          if (parsed.error) {
            return resolve(this.createFailedResult(runRef, parsed.error));
          }
          const validated = AgentRunResultSchema.parse(parsed);
          resolve(validated);
        } catch (e) {
          resolve(this.createFailedResult(runRef, `Invalid JSON or output from Python: ${e instanceof Error ? e.message : String(e)}`));
        }
      });

      child.on('error', (err) => {
        this.activeProcesses.delete(runId);
        resolve(this.createFailedResult(runRef, `Process spawn error: ${err.message}`));
      });
    });

    this.activeResults.set(runId, resultPromise);
    // Retained in memory to support resumability/delayed callers. In a production cluster, this would be backed by Redis or an event store.

    // Send data to stdin
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

    // SDK-graceful via SIGTERM
    child.kill('SIGTERM');

    // Wait 2000ms, then escalate to SIGKILL
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
      summary,
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
