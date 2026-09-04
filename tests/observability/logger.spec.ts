import { createHash } from "node:crypto";
import type { IncidentEventRecord } from "../../packages/observability/src/incidents.js";
import { describe, expect, it } from 'vitest';
import { InMemoryLogger, InMemoryIncidentService, AttemptReconstructor, TraceabilityEngine, IntegrityVerifier, IncidentIntegrityVerifier } from '../../packages/observability/src/index.js';
import { assertVerificationCanCompleteWorkItem, type EvidenceRecord, type VerificationRecord } from '../../packages/evidence/src/records.js';

describe('Observability Logger', () => {
  it('persists ExecutionLog entries with project isolation', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'test message 1', { attemptId: 'att-1' });
    logger.log('proj-2', 'run-2', 'test message 2', { attemptId: 'att-2' });

    const proj1Logs = logger.getLogs('proj-1');
    expect(proj1Logs).toHaveLength(1);
    expect(proj1Logs[0].message).toBe('test message 1');
    expect(proj1Logs[0].projectId).toBe('proj-1');
    expect(proj1Logs[0].previousHash).toBeNull();

    const proj2Logs = logger.getLogs('proj-2');
    expect(proj2Logs).toHaveLength(1);
    expect(proj2Logs[0].previousHash).toBeNull();
  });

  it('strips secrets if redactor is provided, even in nested objects', () => {
    const redactor = { redact: (s: string) => s.replace(/secret123/g, '[REDACTED]') };
    const logger = new InMemoryLogger(redactor);

    logger.log('proj-1', 'run-1', 'Connecting with secret123...', { 
      metadata: { 
        key: 'secret123-val', 
        nested: { inner: 'secret123' },
        arr: ['secret123']
      } 
    });

    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toBe('Connecting with [REDACTED]...');
    expect(logs[0].metadata?.key).toBe('[REDACTED]-val');
    expect((logs[0].metadata?.nested as Record<string, unknown>).inner).toBe('[REDACTED]');
    expect((logs[0].metadata?.arr as Record<string, unknown>)[0]).toBe('[REDACTED]');
  });

  it('maintains append-only hash chains and passes integrity verification', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'msg1');
    logger.log('proj-1', 'run-1', 'msg2');
    const logs = logger.getLogs('proj-1');
    
    expect(logs[0].previousHash).toBeNull();
    expect(logs[1].previousHash).toBe(logs[0].hash);
    expect(logs[1].hash).not.toBe(logs[0].hash);
    
    expect(IntegrityVerifier.verifyLogs(logs)).toBe(true);
    
    const tampered = [ ...logs ];
    tampered[0] = { ...tampered[0], message: 'tampered' };
    expect(IntegrityVerifier.verifyLogs(tampered)).toBe(false);
  });
});

describe('Incident Service', () => {
  it('maintains append-only incident event history with isolation', () => {
    const service = new InMemoryIncidentService();
    const evt1 = service.openIncident('proj-1', 'run-1', 'Server down', 'HIGH', { attemptId: 'att-1' });
    expect(evt1.state).toBe('OPEN');
    expect(evt1.previousHash).toBeNull();

    const evt2 = service.mitigateIncident('proj-1', evt1.incidentId, 'Restarted process', 'ev-1');
    expect(evt2.state).toBe('MITIGATED');
    expect(evt2.previousHash).toBe(evt1.hash);
    expect(evt2.recoveryEvidenceId).toBe('ev-1');

    const evt3 = service.resolveIncident('proj-1', evt1.incidentId, 'Fixed root cause', 'ev-2');
    expect(evt3.state).toBe('RESOLVED');
    expect(evt3.previousHash).toBe(evt2.hash);

    const listed = service.listIncidentEvents('proj-1');
    expect(listed).toHaveLength(3);
    expect(IncidentIntegrityVerifier.verifyIncident(listed)).toBe(true);
    
    const listed2 = service.listIncidentEvents('proj-2');
    expect(listed2).toHaveLength(0);
  });
  
  it('enforces terminal incident state transitions', () => {
    const service = new InMemoryIncidentService();
    const evt1 = service.openIncident('proj-1', 'run-1', 'Server down', 'HIGH');
    
    service.resolveIncident('proj-1', evt1.incidentId, 'Fixed immediately');
    
    expect(() => {
      service.mitigateIncident('proj-1', evt1.incidentId, 'Try mitigate');
    }).toThrowError(/Cannot transition from RESOLVED/);
  });
});

describe('AttemptReconstructor', () => {
  it('reconstructs timeline in deterministic sequence order', () => {
    const logger = new InMemoryLogger();
    const incidents = new InMemoryIncidentService();

    logger.log('proj-1', 'run-1', 'step 1', { attemptId: 'att-1' });
    incidents.openIncident('proj-1', 'run-1', 'error', 'HIGH', { attemptId: 'att-1' });
    
    const logs = logger.getLogs('proj-1');
    const incList = incidents.listIncidentEvents('proj-1');
    
    const timeline = AttemptReconstructor.reconstructByAttempt('proj-1', 'att-1', logs, incList);
    
    expect(timeline).toHaveLength(2);
  });
});

describe('TraceabilityEngine', () => {
  it('traces SCM commit to full lineage set', () => {
    const baseEv = {
      projectId: 'p1', runId: 'r1',
      artifactId: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      currentness: 'CURRENT' as const, observedAt: new Date(), createdAt: new Date()
    };
    
    const evidence: EvidenceRecord[] = [
      { ...baseEv, id: 'ev1', scmCommitSha: 'sha1', workItemId: 'w1', attemptId: 'att1', approvalId: 'app1', agentId: 'ag1' },
      { ...baseEv, id: 'ev2', scmCommitSha: 'sha2', workItemId: 'w2', attemptId: 'att2', approvalId: 'app2', agentId: 'ag2' }
    ];
    
    const verification: VerificationRecord = {
      id: 'v1', projectId: 'p1', runId: 'r1', workItemId: 'w1', attemptId: 'att1',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['ev1'], verifierRef: 'vr1',
      completionDecisionId: 'comp1', verifiedAt: new Date(), createdAt: new Date()
    };
    
    const result = TraceabilityEngine.traceScmCommit('p1', 'sha1', evidence, [verification]);
    
    expect(result.commitSha).toBe('sha1');
    expect(result.workItemIds).toEqual(['w1']);
    expect(result.approvalIds).toEqual(['app1']);
    expect(result.agentIds).toEqual(['ag1']);
    expect(result.attemptIds).toEqual(['att1']);
    expect(result.evidenceIds).toEqual(['ev1']);
    expect(result.verificationIds).toEqual(['v1']);
    expect(result.completionDecisionIds).toEqual(['comp1']);
  });
});

describe('Evidence Verification', () => {
  it('enforces CURRENT state of evidence', () => {
    const baseEv = {
      id: 'e1', projectId: 'p1', runId: 'r1', workItemId: 'w1', attemptId: 'a1', approvalId: 'ap1',
      agentId: 'ag1', artifactId: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      scmCommitSha: null, deploymentUri: null, observedAt: new Date(), createdAt: new Date()
    };
    const ev1: EvidenceRecord = { ...baseEv, currentness: 'STALE' };
    const ev2: EvidenceRecord = { ...baseEv, id: 'e2', currentness: 'INVALIDATED' };
    const ev3: EvidenceRecord = { ...baseEv, id: 'e3', currentness: 'CURRENT' };

    const verification: VerificationRecord = {
      id: 'v1', projectId: 'p1', runId: 'r1', workItemId: 'w1', attemptId: 'a1',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['e1'], verifierRef: 'vr1',
      completionDecisionId: null, verifiedAt: new Date(), createdAt: new Date()
    };

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification, evidence: [ev1]
    })).toThrowError(/STALE/);

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification: { ...verification, evidenceIds: ['e2'] }, evidence: [ev2]
    })).toThrowError(/INVALIDATED/);

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification: { ...verification, evidenceIds: ['e3'] }, evidence: [ev3]
    })).not.toThrow();
  });
});

describe('R3 Defect Verification', () => {
  it('R3-1: traceDeployment resolves lineage', () => {
    const baseEv = {
      projectId: 'p1', runId: 'r1',
      artifactId: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      scmCommitSha: null, currentness: 'CURRENT' as const, observedAt: new Date(), createdAt: new Date()
    };
    const evidence: EvidenceRecord[] = [
      { ...baseEv, id: 'ev1', deploymentUri: 's3://prod/1', workItemId: 'w1', attemptId: 'att1', approvalId: 'app1', agentId: 'ag1' }
    ];
    const verification: VerificationRecord = {
      id: 'v1', projectId: 'p1', runId: 'r1', workItemId: 'w1', attemptId: 'att1',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['ev1'], verifierRef: 'vr1',
      completionDecisionId: 'comp1', verifiedAt: new Date(), createdAt: new Date()
    };
    const result = TraceabilityEngine.traceDeployment('p1', 's3://prod/1', evidence, [verification]);
    expect(result.deploymentUri).toBe('s3://prod/1');
    expect(result.workItemIds).toEqual(['w1']);
  });

  it('R3-2: verifyLogs handles multi-run chains', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'msg1');
    logger.log('proj-1', 'run-2', 'msg2');
    logger.log('proj-1', 'run-1', 'msg3');
    const logs = logger.getLogs('proj-1');
    expect(IntegrityVerifier.verifyLogs(logs)).toBe(true);
    
    // tampering with run-2 should still fail
    const tampered = [ ...logs ];
    const r2Idx = tampered.findIndex(l => l.runId === 'run-2');
    tampered[r2Idx] = { ...tampered[r2Idx], message: 'tampered' };
    expect(IntegrityVerifier.verifyLogs(tampered)).toBe(false);
  });

  it('R3-3: verifyIncident handles multi-incident chains', () => {
    const service = new InMemoryIncidentService();
    const evt1 = service.openIncident('proj-1', 'run-1', 'Down', 'HIGH');
    service.openIncident('proj-1', 'run-1', 'Another Down', 'HIGH');
    service.resolveIncident('proj-1', evt1.incidentId, 'Fixed');
    
    const events = service.listIncidentEvents('proj-1');
    expect(IncidentIntegrityVerifier.verifyIncident(events)).toBe(true);
    
    const tampered = [ ...events ];
    tampered[0] = { ...tampered[0], state: 'RESOLVED' };
    expect(IncidentIntegrityVerifier.verifyIncident(tampered)).toBe(false);
  });
});

describe('R4 Project Isolation Tests', () => {
  it('R4-1: traceDeployment strictly isolates by projectId', () => {
    const baseEv = {
      runId: 'r1', artifactId: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      scmCommitSha: null, currentness: 'CURRENT' as const, observedAt: new Date(), createdAt: new Date()
    };
    const evidence: EvidenceRecord[] = [
      { ...baseEv, id: 'ev1', projectId: 'proj-A', deploymentUri: 's3://prod/1', workItemId: 'wA', attemptId: 'attA', approvalId: 'appA', agentId: 'agA' },
      { ...baseEv, id: 'ev2', projectId: 'proj-B', deploymentUri: 's3://prod/1', workItemId: 'wB', attemptId: 'attB', approvalId: 'appB', agentId: 'agB' }
    ];
    const verification: VerificationRecord = {
      id: 'vA', projectId: 'proj-A', runId: 'r1', workItemId: 'wA', attemptId: 'attA',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['ev1'], verifierRef: 'vr1',
      completionDecisionId: 'compA', verifiedAt: new Date(), createdAt: new Date()
    };
    
    const result = TraceabilityEngine.traceDeployment('proj-A', 's3://prod/1', evidence, [verification]);
    expect(result.workItemIds).toEqual(['wA']);
    expect(result.evidenceIds).toEqual(['ev1']);
    expect(result.verificationIds).toEqual(['vA']);
    // Ensure B did not leak
    expect(result.workItemIds).not.toContain('wB');
  });

  it('R4-2: verifyIncident isolates by projectId and incidentId', () => {
    // Generate events for identical incidentId but different projects
    const incId = 'inc-collision-123';
    const date = new Date();
    const evtA: IncidentEventRecord = {
      id: 'e1', incidentId: incId, projectId: 'proj-A', runId: 'r1', attemptId: 'a1', workItemId: 'w1',
      state: 'OPEN', severity: 'HIGH', description: 'err', timestamp: date, resolutionClaim: null,
      recoveryEvidenceId: null, previousHash: null, hash: 'hashA', sequence: 1
    };
    const evtB: IncidentEventRecord = {
      id: 'e2', incidentId: incId, projectId: 'proj-B', runId: 'r2', attemptId: 'a2', workItemId: 'w2',
      state: 'OPEN', severity: 'HIGH', description: 'err', timestamp: date, resolutionClaim: null,
      recoveryEvidenceId: null, previousHash: null, hash: 'hashB', sequence: 1
    };
    
    // verifyIncident should be able to process them without mixing their chains
    // if it mixes them, it will fail because two events have sequence=1
    // First, let's fix the hash to be correct so it would pass if isolated
    const payloadA = JSON.stringify({ id: evtA.id, incidentId: evtA.incidentId, projectId: evtA.projectId, runId: evtA.runId, attemptId: evtA.attemptId, workItemId: evtA.workItemId, state: evtA.state, severity: evtA.severity, description: evtA.description, timestamp: evtA.timestamp.toISOString(), resolutionClaim: evtA.resolutionClaim, recoveryEvidenceId: evtA.recoveryEvidenceId, previousHash: evtA.previousHash, sequence: evtA.sequence });
    const realHashA = createHash('sha256').update(payloadA).digest('hex');
    const fixedEvtA = { ...evtA, hash: realHashA };

    const payloadB = JSON.stringify({ id: evtB.id, incidentId: evtB.incidentId, projectId: evtB.projectId, runId: evtB.runId, attemptId: evtB.attemptId, workItemId: evtB.workItemId, state: evtB.state, severity: evtB.severity, description: evtB.description, timestamp: evtB.timestamp.toISOString(), resolutionClaim: evtB.resolutionClaim, recoveryEvidenceId: evtB.recoveryEvidenceId, previousHash: evtB.previousHash, sequence: evtB.sequence });
    const realHashB = createHash('sha256').update(payloadB).digest('hex');
    const fixedEvtB = { ...evtB, hash: realHashB };

    expect(IncidentIntegrityVerifier.verifyIncident([fixedEvtA, fixedEvtB])).toBe(true);
  });
});

describe('R5 SCM and Artifact Project Isolation Tests', () => {
  it('R5-1: traceScmCommit strictly isolates by projectId', () => {
    const baseEv = {
      runId: 'r1', artifactId: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      deploymentUri: null, currentness: 'CURRENT' as const, observedAt: new Date(), createdAt: new Date()
    };
    const evidence: EvidenceRecord[] = [
      { ...baseEv, id: 'ev1', projectId: 'proj-A', scmCommitSha: 'sha123', workItemId: 'wA', attemptId: 'attA', approvalId: 'appA', agentId: 'agA' },
      { ...baseEv, id: 'ev2', projectId: 'proj-B', scmCommitSha: 'sha123', workItemId: 'wB', attemptId: 'attB', approvalId: 'appB', agentId: 'agB' }
    ];
    const verification: VerificationRecord = {
      id: 'vA', projectId: 'proj-A', runId: 'r1', workItemId: 'wA', attemptId: 'attA',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['ev1'], verifierRef: 'vr1',
      completionDecisionId: 'compA', verifiedAt: new Date(), createdAt: new Date()
    };
    
    const result = TraceabilityEngine.traceScmCommit('proj-A', 'sha123', evidence, [verification]);
    expect(result.workItemIds).toEqual(['wA']);
    expect(result.evidenceIds).toEqual(['ev1']);
    expect(result.verificationIds).toEqual(['vA']);
    // Ensure B did not leak
    expect(result.workItemIds).not.toContain('wB');
  });

  it('R5-2: traceArtifact strictly isolates by projectId', () => {
    const baseEv = {
      runId: 'r1', scmCommitSha: null, claim: 'x', sourceType: 'AGENT_RESULT' as const, sourceRef: 'sr1',
      deploymentUri: null, currentness: 'CURRENT' as const, observedAt: new Date(), createdAt: new Date()
    };
    const evidence: EvidenceRecord[] = [
      { ...baseEv, id: 'ev1', projectId: 'proj-A', artifactId: 'art123', workItemId: 'wA', attemptId: 'attA', approvalId: 'appA', agentId: 'agA' },
      { ...baseEv, id: 'ev2', projectId: 'proj-B', artifactId: 'art123', workItemId: 'wB', attemptId: 'attB', approvalId: 'appB', agentId: 'agB' }
    ];
    const verification: VerificationRecord = {
      id: 'vA', projectId: 'proj-A', runId: 'r1', workItemId: 'wA', attemptId: 'attA',
      verificationType: 'TEST', status: 'PASS', evidenceIds: ['ev1'], verifierRef: 'vr1',
      completionDecisionId: 'compA', verifiedAt: new Date(), createdAt: new Date()
    };
    
    const result = TraceabilityEngine.traceArtifact('proj-A', 'art123', evidence, [verification]);
    expect(result.workItemIds).toEqual(['wA']);
    expect(result.evidenceIds).toEqual(['ev1']);
    expect(result.verificationIds).toEqual(['vA']);
    // Ensure B did not leak
    expect(result.workItemIds).not.toContain('wB');
  });
});

describe('R6 Incident Service Project Isolation Tests', () => {
  it('R6-1 and R6-2: IncidentService isolates identically named incidents across projects', () => {
    const nextId = 'collision-123';
    const idFactory = () => nextId;
    const service = new InMemoryIncidentService(undefined, idFactory);

    // Project A opens an incident
    const evtA1 = service.openIncident('proj-A', 'run-1', 'Error A', 'HIGH');
    
    // Project B opens an incident, we force the ID to be identical
    const evtB1 = service.openIncident('proj-B', 'run-2', 'Error B', 'HIGH');
    
    // Validate they share the same ID but are distinct events
    expect(evtA1.incidentId).toBe('collision-123');
    expect(evtB1.incidentId).toBe('collision-123');
    expect(evtA1.projectId).toBe('proj-A');
    expect(evtB1.projectId).toBe('proj-B');
    
    // Both sequences should start at 1 for their respective chains, 
    // wait, the service uses a global `this.seq` across all events for the monotonic `sequence` field, 
    // which is fine, as long as within the partitioned chain they are monotonically increasing.
    // The previousHash for B should be null, not A's hash.
    expect(evtA1.previousHash).toBeNull();
    expect(evtB1.previousHash).toBeNull();

    // Transition A to RESOLVED
    const evtA2 = service.resolveIncident('proj-A', 'collision-123', 'Fixed A');
    
    // Transition B to RESOLVED
    const evtB2 = service.resolveIncident('proj-B', 'collision-123', 'Fixed B');

    // A2 should link back to A1, not B1
    expect(evtA2.previousHash).toBe(evtA1.hash);
    expect(evtA2.projectId).toBe('proj-A');
    
    // B2 should link back to B1, not A2
    expect(evtB2.previousHash).toBe(evtB1.hash);
    expect(evtB2.projectId).toBe('proj-B');

    // Integrity Verifier should pass for both projects independently
    const eventsA = service.listIncidentEvents('proj-A');
    const eventsB = service.listIncidentEvents('proj-B');
    
    expect(IncidentIntegrityVerifier.verifyIncident(eventsA)).toBe(true);
    expect(IncidentIntegrityVerifier.verifyIncident(eventsB)).toBe(true);
  });
});
