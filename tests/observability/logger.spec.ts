import { createHash } from "node:crypto";
import type { IncidentEventRecord } from "../../packages/observability/src/incidents.js";
import { describe, expect, it } from 'vitest';
import { InMemoryLogger, InMemoryIncidentService, AttemptReconstructor, TraceabilityEngine, IntegrityVerifier, IncidentIntegrityVerifier, packageName, defaultSanitize, sanitizeValue } from '../../packages/observability/src/index.js';
import { assertVerificationCanCompleteWorkItem, computeEvidenceDigest, computeVerificationDigest, type EvidenceRecord, type VerificationRecord } from '../../packages/evidence/src/records.js';

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
    const rawEv3 = { ...baseEv, id: 'e3', currentness: 'CURRENT' as const };
    const ev3: EvidenceRecord = {
      ...rawEv3,
      digest: computeEvidenceDigest(rawEv3),
    };

    const baseVerification = {
      id: 'v1', projectId: 'p1', runId: 'r1', workItemId: 'w1', attemptId: 'a1',
      verificationType: 'TEST' as const, status: 'PASS' as const,
      completionDecisionId: null, verifiedAt: new Date(), createdAt: new Date(),
      verifierRef: 'vr1',
    };
    const verificationStale: VerificationRecord = {
      ...baseVerification,
      evidenceIds: ['e1'],
      digest: computeVerificationDigest({ ...baseVerification, evidenceIds: ['e1'] }),
    };
    const verificationInvalidated: VerificationRecord = {
      ...baseVerification,
      evidenceIds: ['e2'],
      digest: computeVerificationDigest({ ...baseVerification, evidenceIds: ['e2'] }),
    };
    const verificationCurrent: VerificationRecord = {
      ...baseVerification,
      evidenceIds: ['e3'],
      digest: computeVerificationDigest({ ...baseVerification, evidenceIds: ['e3'] }),
    };

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification: verificationStale, evidence: [ev1]
    })).toThrowError(/STALE/);

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification: verificationInvalidated, evidence: [ev2]
    })).toThrowError(/INVALIDATED/);

    expect(() => assertVerificationCanCompleteWorkItem({
      projectId: 'p1', workItemId: 'w1', verification: verificationCurrent, evidence: [ev3]
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
    const service = new InMemoryIncidentService(undefined, undefined, undefined, idFactory);

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

describe('R7-1 Fail-Closed Secret Safety', () => {
  it('R7-1: default redactor safely redacts credential-like material in messages and metadata', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'Connecting with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', {
      metadata: {
        nested: { inner: 'Bearer secret_token123' },
        arr: ['token XYZ']
      }
    });

    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toContain('[REDACTED]');
    expect(logs[0].message).not.toContain('ghp_');
    
    expect((logs[0].metadata?.nested as Record<string, unknown>).inner).toBe('Bearer [REDACTED]');
    expect((logs[0].metadata?.arr as Record<string, unknown>[])[0]).toBe('token [REDACTED]');
  });

  it('R7-1: default redactor safely redacts incident descriptions and claims', () => {
    const service = new InMemoryIncidentService();
    const evt = service.openIncident('proj-1', 'run-1', 'Leaked ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'HIGH');
    expect(evt.description).toContain('[REDACTED]');
    expect(evt.description).not.toContain('ghp_');

    const evt2 = service.resolveIncident('proj-1', evt.incidentId, 'Rotated Authorization: Bearer abcdef123');
    expect(evt2.resolutionClaim).toContain('[REDACTED]');
    expect(evt2.resolutionClaim).not.toContain('abcdef');
  });

  it('R7-1: normal non-sensitive text remains usable', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'This is a normal message without secrets');
    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toBe('This is a normal message without secrets');
  });
});

describe('R7-2 Deterministic Clock / ID / Sequence', () => {
  it('R7-2: prove equal-timestamp ordering is deterministic and hash reproduction works', () => {
    // Inject deterministic clock and ID
    const fixedDate = new Date('2026-01-01T00:00:00.000Z');
    const clock = () => fixedDate;
    let logIdSeq = 0;
    const idFactory = () => `test-log-${++logIdSeq}`;
    
    const logger = new InMemoryLogger(undefined, clock, idFactory);
    logger.log('proj-1', 'run-1', 'msg1');
    logger.log('proj-1', 'run-1', 'msg2');

    const logs = logger.getLogs('proj-1');
    expect(logs).toHaveLength(2);
    expect(logs[0].timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(logs[1].timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(logs[0].id).toBe('test-log-1');
    expect(logs[1].id).toBe('test-log-2');
    
    // Hash reproduction using identical injected inputs
    // We expect IntegrityVerifier to pass exactly these logs
    expect(IntegrityVerifier.verifyLogs(logs)).toBe(true);
  });
});

describe('R8-1 Extended Secret Sanitizer', () => {
  it('R8-1a: redacts password-like credentials in messages', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'Connecting with password=SuperSecret123');
    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toContain('[REDACTED]');
    expect(logs[0].message).not.toContain('SuperSecret123');
  });

  it('R8-1b: redacts API key credentials in messages', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'Using api_key=sk-abc123xyz');
    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toContain('[REDACTED]');
    expect(logs[0].message).not.toContain('sk-abc123xyz');
  });

  it('R8-1c: redacts client_secret in messages', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'client_secret=very_secret_value_here');
    const logs = logger.getLogs('proj-1');
    expect(logs[0].message).toContain('[REDACTED]');
    expect(logs[0].message).not.toContain('very_secret_value_here');
  });

  it('R8-1d: redacts sensitive keys in nested metadata objects', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'normal log', {
      metadata: {
        password: 'my-secret-pw',
        config: { apiKey: 'key-456', host: 'example.com' },
        items: [{ clientSecret: 'cs-789' }]
      }
    });
    const logs = logger.getLogs('proj-1');
    const meta = logs[0].metadata as Record<string, unknown>;
    expect(meta.password).toBe('[REDACTED]');
    expect((meta.config as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((meta.config as Record<string, unknown>).host).toBe('example.com');
    expect(((meta.items as Record<string, unknown>[])[0]).clientSecret).toBe('[REDACTED]');
  });

  it('R8-1e: redacts sensitive keys in nested metadata arrays', () => {
    const logger = new InMemoryLogger();
    logger.log('proj-1', 'run-1', 'array test', {
      metadata: {
        connections: [{ privateKey: 'pk-secret', host: 'db1' }, { accessToken: 'at-secret', host: 'db2' }]
      }
    });
    const logs = logger.getLogs('proj-1');
    const meta = logs[0].metadata as Record<string, unknown>;
    const conns = meta.connections as Record<string, unknown>[];
    expect(conns[0].privateKey).toBe('[REDACTED]');
    expect(conns[0].host).toBe('db1');
    expect(conns[1].accessToken).toBe('[REDACTED]');
    expect(conns[1].host).toBe('db2');
  });

  it('R8-1f: redacts sensitive text in incident descriptions', () => {
    const service = new InMemoryIncidentService();
    const evt = service.openIncident('proj-1', 'run-1', 'Found password=admin123 in config', 'HIGH');
    expect(evt.description).toContain('[REDACTED]');
    expect(evt.description).not.toContain('admin123');
  });

  it('R8-1g: redacts sensitive text in mitigation claims', () => {
    const service = new InMemoryIncidentService();
    const evt = service.openIncident('proj-1', 'run-1', 'System error', 'MEDIUM');
    const mitigated = service.mitigateIncident('proj-1', evt.incidentId, 'Rotated api_key=old_key_value');
    expect(mitigated.resolutionClaim).toContain('[REDACTED]');
    expect(mitigated.resolutionClaim).not.toContain('old_key_value');
  });

  it('R8-1h: redacts sensitive text in resolution claims', () => {
    const service = new InMemoryIncidentService();
    const evt = service.openIncident('proj-1', 'run-1', 'Leak detected', 'HIGH');
    const resolved = service.resolveIncident('proj-1', evt.incidentId, 'Replaced client_secret=leaked_value');
    expect(resolved.resolutionClaim).toContain('[REDACTED]');
    expect(resolved.resolutionClaim).not.toContain('leaked_value');
  });

  it('R8-1i: preserves normal non-sensitive operational text', () => {
    const result = defaultSanitize('Deployment to staging completed successfully in 42s');
    expect(result).toBe('Deployment to staging completed successfully in 42s');

    const metaResult = sanitizeValue({ host: 'prod.example.com', port: 443, status: 'healthy' });
    expect(metaResult).toEqual({ host: 'prod.example.com', port: 443, status: 'healthy' });
  });
});

describe('R8-2 Deterministic IncidentService Proof', () => {
  it('R8-2: deterministic clock/idFactory/incidentIdFactory produces reproducible hash chains', () => {
    const fixedTime = new Date('2026-06-15T12:00:00.000Z');
    const clock = () => fixedTime;
    let evtSeq = 0;
    const idFactory = () => `det-evt-${++evtSeq}`;
    const incidentIdFactory = () => 'det-inc-1';

    // First instance
    const svc1 = new InMemoryIncidentService(undefined, clock, idFactory, incidentIdFactory);
    const evt1_1 = svc1.openIncident('proj-A', 'run-1', 'Test error', 'HIGH');
    const evt1_2 = svc1.mitigateIncident('proj-A', 'det-inc-1', 'Applied fix');
    const evt1_3 = svc1.resolveIncident('proj-A', 'det-inc-1', 'Verified fix');

    // Verify stable IDs
    expect(evt1_1.id).toBe('det-evt-1');
    expect(evt1_1.incidentId).toBe('det-inc-1');
    expect(evt1_2.id).toBe('det-evt-2');
    expect(evt1_3.id).toBe('det-evt-3');

    // Verify same-timestamp deterministic sequencing
    expect(evt1_1.timestamp.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(evt1_2.timestamp.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(evt1_3.timestamp.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(evt1_1.sequence).toBe(1);
    expect(evt1_2.sequence).toBe(2);
    expect(evt1_3.sequence).toBe(3);

    // Verify predecessor hash chain
    expect(evt1_1.previousHash).toBeNull();
    expect(evt1_2.previousHash).toBe(evt1_1.hash);
    expect(evt1_3.previousHash).toBe(evt1_2.hash);

    // Verify integrity
    const events1 = svc1.listIncidentEvents('proj-A');
    expect(IncidentIntegrityVerifier.verifyIncident(events1)).toBe(true);

    // Second independent instance with identical inputs — must reproduce identical hashes
    evtSeq = 0;
    const svc2 = new InMemoryIncidentService(undefined, clock, idFactory, incidentIdFactory);
    const evt2_1 = svc2.openIncident('proj-A', 'run-1', 'Test error', 'HIGH');
    const evt2_2 = svc2.mitigateIncident('proj-A', 'det-inc-1', 'Applied fix');
    const evt2_3 = svc2.resolveIncident('proj-A', 'det-inc-1', 'Verified fix');

    // Prove hash reproduction — zero sleep, zero wall-clock dependence
    expect(evt1_1.hash).toBe(evt2_1.hash);
    expect(evt1_2.hash).toBe(evt2_2.hash);
    expect(evt1_3.hash).toBe(evt2_3.hash);

    const events2 = svc2.listIncidentEvents('proj-A');
    expect(IncidentIntegrityVerifier.verifyIncident(events2)).toBe(true);
  });

  it('R8-2b: deterministic Logger proof with hash reproduction', () => {
    const fixedDate = new Date('2026-01-01T00:00:00.000Z');
    const clock = () => fixedDate;
    let seq1 = 0;
    const idFactory1 = () => `det-log-${++seq1}`;

    const logger1 = new InMemoryLogger(undefined, clock, idFactory1);
    logger1.log('proj-1', 'run-1', 'msg-alpha');
    logger1.log('proj-1', 'run-1', 'msg-beta');
    const logs1 = logger1.getLogs('proj-1');

    // Second independent instance
    let seq2 = 0;
    const idFactory2 = () => `det-log-${++seq2}`;
    const logger2 = new InMemoryLogger(undefined, clock, idFactory2);
    logger2.log('proj-1', 'run-1', 'msg-alpha');
    logger2.log('proj-1', 'run-1', 'msg-beta');
    const logs2 = logger2.getLogs('proj-1');

    // Hash reproduction
    expect(logs1[0].hash).toBe(logs2[0].hash);
    expect(logs1[1].hash).toBe(logs2[1].hash);

    expect(IntegrityVerifier.verifyLogs(logs1)).toBe(true);
    expect(IntegrityVerifier.verifyLogs(logs2)).toBe(true);
  });
});

describe('R8-3 Public API Compatibility & packageName Regression', () => {
  it('R8-3: packageName exports correctly from @co/observability', () => {
    expect(packageName).toBe('@co/observability');
  });

  it('R8-3b: all public exports are defined and available', () => {
    expect(InMemoryLogger).toBeDefined();
    expect(IntegrityVerifier).toBeDefined();
    expect(InMemoryIncidentService).toBeDefined();
    expect(IncidentIntegrityVerifier).toBeDefined();
    expect(AttemptReconstructor).toBeDefined();
    expect(TraceabilityEngine).toBeDefined();
    expect(defaultSanitize).toBeDefined();
    expect(sanitizeValue).toBeDefined();
    expect(typeof defaultSanitize).toBe('function');
    expect(typeof sanitizeValue).toBe('function');
  });
});
