import { createHash } from 'node:crypto';
import { Redactor, defaultRedactor } from './redactor.js';

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentState = 'OPEN' | 'RESOLVED' | 'MITIGATED';

export interface IncidentEventRecord {
  readonly id: string;
  readonly incidentId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly attemptId: string | null;
  readonly workItemId: string | null;
  readonly state: IncidentState;
  readonly severity: IncidentSeverity;
  readonly description: string;
  readonly timestamp: Date;
  readonly resolutionClaim: string | null;
  readonly recoveryEvidenceId: string | null;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly sequence: number;
}

export interface IncidentService {
  openIncident(projectId: string, runId: string, description: string, severity: IncidentSeverity, context?: { attemptId?: string, workItemId?: string }): IncidentEventRecord;
  resolveIncident(projectId: string, incidentId: string, resolutionClaim: string, recoveryEvidenceId?: string): IncidentEventRecord;
  mitigateIncident(projectId: string, incidentId: string, mitigationClaim: string, recoveryEvidenceId?: string): IncidentEventRecord;
  listIncidentEvents(projectId: string): readonly IncidentEventRecord[];
}

export class IncidentIntegrityVerifier {
  public static verifyIncident(events: readonly IncidentEventRecord[]): boolean {
    const chains = new Map<string, IncidentEventRecord[]>();
    for (const evt of events) {
      const key = `${evt.projectId}:${evt.incidentId}`;
      let chain = chains.get(key);
      if (!chain) {
        chain = [];
        chains.set(key, chain);
      }
      chain.push(evt);
    }

    for (const chain of chains.values()) {
      chain.sort((a, b) => a.sequence - b.sequence);
      let expectedPrevHash: string | null = null;
      let seqCheck = -1;
      for (const evt of chain) {
        if (seqCheck !== -1 && evt.sequence <= seqCheck) return false;
        seqCheck = evt.sequence;
        if (evt.previousHash !== expectedPrevHash) return false;
        const payload: string = JSON.stringify({
          id: evt.id, incidentId: evt.incidentId, projectId: evt.projectId, runId: evt.runId, 
          attemptId: evt.attemptId, workItemId: evt.workItemId, state: evt.state, severity: evt.severity,
          description: evt.description, timestamp: evt.timestamp.toISOString(), resolutionClaim: evt.resolutionClaim, 
          recoveryEvidenceId: evt.recoveryEvidenceId, previousHash: evt.previousHash, sequence: evt.sequence
        });
        const expectedHash: string = createHash('sha256').update(payload).digest('hex');
        if (evt.hash !== expectedHash) return false;
        expectedPrevHash = expectedHash;
      }
    }
    return true;
  }
}

export class InMemoryIncidentService implements IncidentService {
  private events: IncidentEventRecord[] = [];
  private lastHashByIncident = new Map<string, string>();
  private seq = 0;

  constructor(
    private readonly redactor: Redactor = defaultRedactor,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory?: () => string,
    private readonly incidentIdFactory?: () => string
  ) {}

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
    const sequence = ++this.seq;
    const id = this.idFactory ? this.idFactory() : `inc-evt-${timestamp.getTime()}-${sequence}`;
    
    const key = `${projectId}:${incidentId}`;
    const previousHash = this.lastHashByIncident.get(key) ?? null;

    const payload: string = JSON.stringify({
      id, incidentId, projectId, runId, attemptId, workItemId, state, severity,
      description: rawDesc, timestamp: timestamp.toISOString(), resolutionClaim: rawClaim, recoveryEvidenceId, previousHash, sequence
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    const evt: IncidentEventRecord = {
      id, incidentId, projectId, runId, attemptId, workItemId, state, severity,
      description: rawDesc, timestamp, resolutionClaim: rawClaim, recoveryEvidenceId, previousHash, hash, sequence
    };
    this.lastHashByIncident.set(key, hash);
    this.events.push(evt);
    return evt;
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
    const evts = this.events.filter(e => e.projectId === projectId && e.incidentId === incidentId).sort((a, b) => a.sequence - b.sequence);
    if (evts.length === 0) throw new Error('Incident not found');
    const last = evts[evts.length - 1];
    if (!last) throw new Error("Incident not found");
    
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

  public listIncidentEvents(projectId: string): readonly IncidentEventRecord[] {
    return this.events.filter(i => i.projectId === projectId).sort((a, b) => a.sequence - b.sequence);
  }
}
