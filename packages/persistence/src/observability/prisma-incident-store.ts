import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { IncidentService, IncidentEventRecord, IncidentState, IncidentSeverity } from '@co/observability';
import { Redactor, defaultRedactor } from '@co/observability';
import type { PrismaQueueOptions } from './prisma-logger.js';
import { AsyncMutex } from './async-mutex.js';

export class PrismaIncidentService implements IncidentService {
  private queue: IncidentEventRecord[] = [];
  private readonly drainMutex = new AsyncMutex();
  private scheduledFlushActive = false;
  private seqs = new Map<string, number>();
  private lastHashes = new Map<string, string>();
  // Memory projection to support synchronous transitions
  private eventsProj: IncidentEventRecord[] = [];
  private lastError: Error | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redactor: Redactor = defaultRedactor,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory?: () => string,
    private readonly incidentIdFactory?: () => string,
    private readonly options?: PrismaQueueOptions
  ) {}

  public get pendingCount(): number {
    return this.queue.length;
  }

  public getLastError(): Error | null {
    return this.lastError;
  }

  public clearLastError(): void {
    this.lastError = null;
  }

  public async initialize(projectId: string): Promise<void> {
    const records = await this.prisma.incidentEventRecord.findMany({
      where: { projectId },
      orderBy: { sequence: 'asc' }
    });
    
    for (const r of records) {
      const key = `${r.projectId}:${r.incidentId}`;
      this.seqs.set(key, r.sequence);
      this.lastHashes.set(key, r.hash);
      this.eventsProj.push({
        id: r.id, incidentId: r.incidentId, projectId: r.projectId, runId: r.runId,
        attemptId: r.attemptId, workItemId: r.workItemId, state: r.state as IncidentState,
        severity: r.severity as IncidentSeverity, description: r.description,
        timestamp: r.timestamp, resolutionClaim: r.resolutionClaim,
        recoveryEvidenceId: r.recoveryEvidenceId, previousHash: r.previousHash,
        hash: r.hash, sequence: r.sequence
      });
    }
  }

  private appendEvent(
    incidentId: string,
    projectId: string,
    runId: string,
    attemptId: string | null,
    workItemId: string | null,
    state: IncidentState,
    severity: IncidentSeverity,
    description: string,
    resolutionClaim: string | null,
    recoveryEvidenceId: string | null
  ): IncidentEventRecord {
    const rawDesc = this.redactor.redact(description);
    const rawClaim = resolutionClaim ? this.redactor.redact(resolutionClaim) : null;
    const timestamp = this.clock();
    
    const key = `${projectId}:${incidentId}`;
    let sequence = this.seqs.get(key) ?? 0;
    sequence++;
    this.seqs.set(key, sequence);

    const id = this.idFactory ? this.idFactory() : `inc-evt-${timestamp.getTime()}-${sequence}`;
    const previousHash = this.lastHashes.get(key) ?? null;

    const payload: string = JSON.stringify({
      id, incidentId, projectId, runId, attemptId, workItemId, state, severity,
      description: rawDesc, timestamp: timestamp.toISOString(), resolutionClaim: rawClaim, recoveryEvidenceId, previousHash, sequence
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    const evt: IncidentEventRecord = {
      id, incidentId, projectId, runId, attemptId, workItemId, state, severity,
      description: rawDesc, timestamp, resolutionClaim: rawClaim, recoveryEvidenceId, previousHash, hash, sequence
    };
    
    this.lastHashes.set(key, hash);
    this.eventsProj.push(evt);
    this.queue.push(evt);
    if (this.options?.autoFlush !== false) {
      this.scheduleFlush();
    }
    return evt;
  }

  public scheduleFlush(): void {
    if (this.scheduledFlushActive || this.queue.length === 0 || this.lastError !== null) return;
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
        if (!failed && this.queue.length > 0 && !this.drainMutex.isLocked) {
          this.scheduleFlush();
        }
      }
    });
  }

  public async flush(retries = this.options?.maxRetries ?? 0, delayMs = this.options?.retryDelayMs ?? 10): Promise<void> {
    const release = await this.drainMutex.acquire();
    try {
      while (this.queue.length > 0) {
        const batchSize = this.options?.batchSize ?? 100;
        const batch = this.queue.slice(0, batchSize);
        let attempt = 0;
        let lastErr: unknown = null;

        while (attempt <= retries) {
          try {
            await this.prisma.incidentEventRecord.createMany({
              data: batch.map(e => ({
                id: e.id,
                incidentId: e.incidentId,
                projectId: e.projectId,
                runId: e.runId,
                attemptId: e.attemptId,
                workItemId: e.workItemId,
                state: e.state,
                severity: e.severity,
                description: e.description,
                timestamp: e.timestamp,
                resolutionClaim: e.resolutionClaim,
                recoveryEvidenceId: e.recoveryEvidenceId,
                previousHash: e.previousHash,
                hash: e.hash,
                sequence: e.sequence
              })),
              skipDuplicates: true
            });
            // Remove from queue ONLY after successful persistence
            this.queue.splice(0, batch.length);
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


  public openIncident(projectId: string, runId: string, description: string, severity: IncidentSeverity, context?: { attemptId?: string, workItemId?: string }): IncidentEventRecord {
    const incidentId = this.incidentIdFactory ? this.incidentIdFactory() : `inc-${this.clock().getTime()}-${Math.random().toString(36).slice(2, 7)}`;
    return this.appendEvent(incidentId, projectId, runId, context?.attemptId ?? null, context?.workItemId ?? null, 'OPEN', severity, description, null, null);
  }

  public mitigateIncident(projectId: string, incidentId: string, mitigationClaim: string, recoveryEvidenceId?: string): IncidentEventRecord {
    return this.transitionIncident(projectId, incidentId, 'MITIGATED', mitigationClaim, recoveryEvidenceId);
  }

  public resolveIncident(projectId: string, incidentId: string, resolutionClaim: string, recoveryEvidenceId?: string): IncidentEventRecord {
    return this.transitionIncident(projectId, incidentId, 'RESOLVED', resolutionClaim, recoveryEvidenceId);
  }

  private transitionIncident(projectId: string, incidentId: string, state: IncidentState, claim: string, recoveryEvidenceId?: string): IncidentEventRecord {
    const evts = this.eventsProj.filter(e => e.projectId === projectId && e.incidentId === incidentId).sort((a, b) => a.sequence - b.sequence);
    if (evts.length === 0) throw new Error('Incident not found');
    const last = evts[evts.length - 1];
    if (!last) throw new Error('Incident not found');
    
    if (last.state === 'RESOLVED') {
      throw new Error(`Cannot transition from RESOLVED to ${state}`);
    }
    if (last.state === 'MITIGATED' && state !== 'RESOLVED') {
      throw new Error(`Cannot transition from MITIGATED to ${state}`);
    }
    if (last.state === 'OPEN' && state !== 'MITIGATED' && state !== 'RESOLVED') {
       throw new Error(`Cannot transition from OPEN to ${state}`);
    }
    
    return this.appendEvent(incidentId, projectId, last.runId, last.attemptId, last.workItemId, state, last.severity, last.description, claim, recoveryEvidenceId ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public listIncidentEvents(_projectId: string): readonly IncidentEventRecord[] {
    throw new Error('Sync listIncidentEvents not supported. Use listIncidentEventsAsync');
  }

  public async listIncidentEventsAsync(projectId: string): Promise<readonly IncidentEventRecord[]> {
    const records = await this.prisma.incidentEventRecord.findMany({
      where: { projectId },
      orderBy: { sequence: 'asc' }
    });
    return records.map(r => ({
      id: r.id, incidentId: r.incidentId, projectId: r.projectId, runId: r.runId,
      attemptId: r.attemptId, workItemId: r.workItemId, state: r.state as IncidentState,
      severity: r.severity as IncidentSeverity, description: r.description,
      timestamp: r.timestamp, resolutionClaim: r.resolutionClaim,
      recoveryEvidenceId: r.recoveryEvidenceId, previousHash: r.previousHash,
      hash: r.hash, sequence: r.sequence
    }));
  }
}
