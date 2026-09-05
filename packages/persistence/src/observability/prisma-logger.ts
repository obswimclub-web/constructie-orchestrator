import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { LoggerService, ExecutionLogRecord } from '@co/observability';
import { Redactor, defaultRedactor, sanitizeValue } from '@co/observability';
import { AsyncMutex } from './async-mutex.js';

export interface PrismaQueueOptions {
  batchSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  autoFlush?: boolean;
}

export class PrismaExecutionLogger implements LoggerService {
  private logQueue: ExecutionLogRecord[] = [];
  private readonly drainMutex = new AsyncMutex();
  private scheduledFlushActive = false;
  private seqs = new Map<string, number>();
  private lastHashes = new Map<string, string>();
  private lastError: Error | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redactor: Redactor = defaultRedactor,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory?: () => string,
    private readonly options?: PrismaQueueOptions
  ) {}

  public get pendingCount(): number {
    return this.logQueue.length;
  }

  public getLastError(): Error | null {
    return this.lastError;
  }

  public clearLastError(): void {
    this.lastError = null;
  }

  public async initialize(projectId: string, runId: string): Promise<void> {
    const key = `${projectId}:${runId}`;
    const latest = await this.prisma.executionLogRecord.findFirst({
      where: { projectId, runId },
      orderBy: { sequence: 'desc' },
    });
    this.seqs.set(key, latest?.sequence ?? 0);
    this.lastHashes.set(key, latest?.hash ?? '');
  }

  public log(projectId: string, runId: string, message: string, context?: Omit<Partial<ExecutionLogRecord>, 'id' | 'timestamp' | 'sequence' | 'message' | 'projectId' | 'runId' | 'hash' | 'previousHash'>): void {
    const rawMessage = this.redactor.redact(message);
    
    let cleanMetadata: Record<string, unknown> | undefined;
    if (context?.metadata) {
      cleanMetadata = sanitizeValue(context.metadata, this.redactor) as Record<string, unknown>;
    }

    const timestamp = this.clock();
    const key = `${projectId}:${runId}`;
    
    let seq = this.seqs.get(key) ?? 0;
    seq++;
    this.seqs.set(key, seq);
    
    const id = this.idFactory ? this.idFactory() : `log-${timestamp.getTime()}-${seq}`;
    
    const previousHash = this.lastHashes.get(key) ?? null;
    
    const payload: string = JSON.stringify({
      id, projectId, runId, attemptId: context?.attemptId ?? null, workItemId: context?.workItemId ?? null,
      stream: context?.stream ?? 'SYSTEM', message: rawMessage, sequence: seq, timestamp: timestamp.toISOString(),
      metadata: cleanMetadata, previousHash
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    const logRecord: ExecutionLogRecord = cleanMetadata ? {
      id,
      projectId,
      runId,
      attemptId: context?.attemptId ?? null,
      workItemId: context?.workItemId ?? null,
      stream: context?.stream ?? 'SYSTEM',
      message: rawMessage,
      sequence: seq,
      timestamp,
      metadata: cleanMetadata,
      previousHash,
      hash
    } : {
      id,
      projectId,
      runId,
      attemptId: context?.attemptId ?? null,
      workItemId: context?.workItemId ?? null,
      stream: context?.stream ?? 'SYSTEM',
      message: rawMessage,
      sequence: seq,
      timestamp,
      previousHash,
      hash
    };
    
    this.lastHashes.set(key, hash);
    this.logQueue.push(logRecord);
    if (this.options?.autoFlush !== false) {
      this.scheduleFlush();
    }
  }

  public scheduleFlush(): void {
    if (this.scheduledFlushActive || this.logQueue.length === 0 || this.lastError !== null) return;
    this.scheduledFlushActive = true;
    Promise.resolve().then(async () => {
      let failed = false;
      try {
        await this.flush();
      } catch {
        // Error captured in this.lastError by flush()
        failed = true;
      } finally {
        this.scheduledFlushActive = false;
        if (!failed && this.logQueue.length > 0 && !this.drainMutex.isLocked) {
          this.scheduleFlush();
        }
      }
    });
  }

  public async flush(retries = this.options?.maxRetries ?? 0, delayMs = this.options?.retryDelayMs ?? 10): Promise<void> {
    const release = await this.drainMutex.acquire();
    try {
      while (this.logQueue.length > 0) {
        const batchSize = this.options?.batchSize ?? 100;
        const batch = this.logQueue.slice(0, batchSize);
        let attempt = 0;
        let lastErr: unknown = null;

        while (attempt <= retries) {
          try {
            await this.prisma.executionLogRecord.createMany({
              data: batch.map(l => ({
                id: l.id,
                projectId: l.projectId,
                runId: l.runId,
                attemptId: l.attemptId,
                workItemId: l.workItemId,
                stream: l.stream,
                message: l.message,
                sequence: l.sequence,
                timestamp: l.timestamp,
                metadata: l.metadata ? (l.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
                previousHash: l.previousHash,
                hash: l.hash
              })),
              skipDuplicates: true
            });
            // Remove from queue ONLY after successful persistence
            this.logQueue.splice(0, batch.length);
            this.lastError = null;
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            attempt++;
            if (attempt <= retries && delayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
        }

        if (lastErr) {
          const error = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
          this.lastError = error;
          throw error;
        }
      }
    } finally {
      release();
    }
  }


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getLogs(_projectId: string, _filter?: { runId?: string, attemptId?: string, workItemId?: string }): readonly ExecutionLogRecord[] {
    throw new Error('Sync getLogs not supported on Prisma logger. Use getLogsAsync.');
  }

  public async getLogsAsync(projectId: string, filter?: { runId?: string, attemptId?: string, workItemId?: string }): Promise<readonly ExecutionLogRecord[]> {
    const where: Prisma.ExecutionLogRecordWhereInput = { projectId };
    if (filter?.runId) where.runId = filter.runId;
    if (filter?.attemptId) where.attemptId = filter.attemptId;
    if (filter?.workItemId) where.workItemId = filter.workItemId;

    const records = await this.prisma.executionLogRecord.findMany({
      where,
      orderBy: { sequence: 'asc' }
    });

    return records.map(r => {
      if (r.metadata) {
        return {
          id: r.id,
          projectId: r.projectId,
          runId: r.runId,
          attemptId: r.attemptId,
          workItemId: r.workItemId,
          stream: r.stream as ExecutionLogRecord['stream'],
          message: r.message,
          sequence: r.sequence,
          timestamp: r.timestamp,
          metadata: r.metadata as Record<string, unknown>,
          previousHash: r.previousHash,
          hash: r.hash
        };
      }
      return {
        id: r.id,
        projectId: r.projectId,
        runId: r.runId,
        attemptId: r.attemptId,
        workItemId: r.workItemId,
        stream: r.stream as ExecutionLogRecord['stream'],
        message: r.message,
        sequence: r.sequence,
        timestamp: r.timestamp,
        previousHash: r.previousHash,
        hash: r.hash
      };
    });
  }
}
