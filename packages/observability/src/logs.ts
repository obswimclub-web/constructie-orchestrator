import { createHash } from 'node:crypto';
import { Redactor, defaultRedactor, sanitizeValue } from './redactor.js';

export interface ExecutionLogRecord {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly attemptId: string | null;
  readonly workItemId: string | null;
  readonly stream: 'STDOUT' | 'STDERR' | 'SYSTEM';
  readonly message: string;
  readonly sequence: number;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
  readonly previousHash: string | null;
  readonly hash: string;
}

export interface LoggerService {
  log(projectId: string, runId: string, message: string, context?: Omit<Partial<ExecutionLogRecord>, 'id' | 'timestamp' | 'sequence' | 'message' | 'projectId' | 'runId' | 'hash' | 'previousHash'>): void;
  getLogs(projectId: string, filter?: { runId?: string, attemptId?: string, workItemId?: string }): readonly ExecutionLogRecord[];
}

export class IntegrityVerifier {
  public static verifyLogs(logs: readonly ExecutionLogRecord[]): boolean {
    const chains = new Map<string, ExecutionLogRecord[]>();
    for (const log of logs) {
      const key = `${log.projectId}:${log.runId}`;
      let chain = chains.get(key);
      if (!chain) {
        chain = [];
        chains.set(key, chain);
      }
      chain.push(log);
    }

    for (const chain of chains.values()) {
      chain.sort((a, b) => a.sequence - b.sequence);
      let expectedPrevHash: string | null = null;
      let seqCheck = -1;
      for (const log of chain) {
        if (seqCheck !== -1 && log.sequence <= seqCheck) return false;
        seqCheck = log.sequence;
        if (log.previousHash !== expectedPrevHash) return false;
        const payload: string = JSON.stringify({
          id: log.id, projectId: log.projectId, runId: log.runId, attemptId: log.attemptId, workItemId: log.workItemId,
          stream: log.stream, message: log.message, sequence: log.sequence, timestamp: log.timestamp.toISOString(),
          metadata: log.metadata, previousHash: log.previousHash
        });
        const expectedHash: string = createHash('sha256').update(payload).digest('hex');
        if (log.hash !== expectedHash) return false;
        expectedPrevHash = expectedHash;
      }
    }
    return true;
  }
}

export class InMemoryLogger implements LoggerService {
  private logs: ExecutionLogRecord[] = [];
  private seq = 0;
  private lastHashes = new Map<string, string>();

  constructor(
    private readonly redactor: Redactor = defaultRedactor,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory?: () => string
  ) {}

  public log(projectId: string, runId: string, message: string, context?: Omit<Partial<ExecutionLogRecord>, 'id' | 'timestamp' | 'sequence' | 'message' | 'projectId' | 'runId' | 'hash' | 'previousHash'>): void {
    const rawMessage = this.redactor.redact(message);
    
    let cleanMetadata: Record<string, unknown> | undefined;
    if (context?.metadata) {
      cleanMetadata = sanitizeValue(context.metadata, this.redactor) as Record<string, unknown>;
    }

    const timestamp = this.clock();
    const sequence = ++this.seq;
    const id = this.idFactory ? this.idFactory() : `log-${timestamp.getTime()}-${sequence}`;
    
    const key = `${projectId}:${runId}`;
    const previousHash = this.lastHashes.get(key) ?? null;
    
    const payload: string = JSON.stringify({
      id, projectId, runId, attemptId: context?.attemptId ?? null, workItemId: context?.workItemId ?? null,
      stream: context?.stream ?? 'SYSTEM', message: rawMessage, sequence, timestamp: timestamp.toISOString(),
      metadata: cleanMetadata, previousHash
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    const logRecord: ExecutionLogRecord = {
      ...(cleanMetadata ? { metadata: cleanMetadata } : {}),
      id,
      projectId,
      runId,
      attemptId: context?.attemptId ?? null,
      workItemId: context?.workItemId ?? null,
      stream: context?.stream ?? 'SYSTEM',
      message: rawMessage,
      sequence,
      timestamp,
      previousHash,
      hash
    };
    
    this.lastHashes.set(key, hash);
    this.logs.push(logRecord);
  }

  public getLogs(projectId: string, filter?: { runId?: string, attemptId?: string, workItemId?: string }): readonly ExecutionLogRecord[] {
    return this.logs.filter(l => 
      l.projectId === projectId &&
      (!filter?.runId || l.runId === filter.runId) &&
      (!filter?.attemptId || l.attemptId === filter.attemptId) &&
      (!filter?.workItemId || l.workItemId === filter.workItemId)
    ).sort((a, b) => a.sequence - b.sequence);
  }
}
