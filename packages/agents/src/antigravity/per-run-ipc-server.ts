import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { AgentRuntimeContext, ToolExecutionResult } from '@co/contracts';
import { ExternalHostToolProposalSchema, ToolExecutionRequestSchema } from '@co/contracts';
import type { GovernedToolGateway } from '@co/tools';
import { OutputRedactor } from '@co/tools';

export class PerRunIpcServer {
  private server?: net.Server;
  public readonly socketPath: string;
  public readonly nonce: string;

  constructor(
    private readonly context: AgentRuntimeContext,
    private readonly gateway: GovernedToolGateway,
    private readonly redactor: OutputRedactor,
    private readonly wp?: import('@co/contracts').WorkPackage,
    private readonly agentId: string = 'agent:antigravity'
  ) {
    this.nonce = randomUUID();
    console.log("PerRunIpcServer constructor redactor:", this.redactor);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-'));
    this.socketPath = path.join(tmpDir, `${this.nonce.slice(0,8)}.sock`);
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', async (data) => {
          buffer += data.toString();
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            await this.handleMessage(line, socket);
          }
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.socketPath, () => {
        fs.chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  private async handleMessage(line: string, socket: net.Socket): Promise<void> {
    try {
      const parsed = JSON.parse(line);
      const proposal = ExternalHostToolProposalSchema.parse(parsed);

      if (proposal.nonce !== this.nonce) {
        throw new Error('Unauthorized IPC connection');
      }

      const executionReq = {
        schemaVersion: '1.0.0' as const,
        requestId: randomUUID(),
        projectId: this.wp?.projectId ?? 'default',
        toolId: proposal.tool,
        operationId: proposal.operation ?? proposal.tool,
        targetResource: 'repo://local',
        parameters: proposal.parameters,
        actorRef: this.agentId,
        workItemRef: this.wp?.workItemId ?? this.context.workflowRunId,
        workPackageRef: this.wp?.workPackageId ?? this.context.workflowRunId,
        authorityContextRef: this.wp?.authorityContextRef ?? 'system',
        correlationId: this.context.correlationId,
        environment: 'LOCAL' as const,
        idempotencyKey: randomUUID()
      };

      const result = await this.gateway.execute(ToolExecutionRequestSchema.parse(executionReq));

      const redactedResult = this.redactResult(result);

      socket.write(JSON.stringify(redactedResult) + '\n');
    } catch (err) {
      socket.write(JSON.stringify({
        error: this.redactor.redact(err instanceof Error ? err.message : String(err))
      }) + '\n');
    }
  }

  private redactResult(res: ToolExecutionResult): ToolExecutionResult {
    return {
      ...res,
      summary: this.redactor.redact(res.summary)
    };
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          try {
            if (fs.existsSync(this.socketPath)) {
              fs.unlinkSync(this.socketPath);
            }
            const dir = path.dirname(this.socketPath);
            if (fs.existsSync(dir)) {
              fs.rmdirSync(dir);
            }
          } catch {
            // ignore
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
