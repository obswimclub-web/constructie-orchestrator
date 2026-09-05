import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ArtifactRecord,
  type EvidenceRecord,
  type VerificationRecord,
  EvidenceTamperedError,
  assertVerificationCanCompleteWorkItem,
  computeVerificationDigest,
  verifyArtifactIntegrity,
  verifyEvidenceIntegrity,
  verifyVerificationIntegrity,
} from '@co/evidence';
import {
  PrismaEvidenceStore,
  DuplicateRecordError,
  WorkStore,
} from '@co/persistence';
import { createProject, createWorkItem } from '@co/domain';
import { EvidenceVerificationService } from '@co/evidence';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator';

function createPrismaClient(): { pool: pg.Pool; prisma: PrismaClient } {
  const pool = new pg.Pool({ connectionString: databaseUrl, password: 'postgres' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { pool, prisma };
}

describe('P9-S2A — Durable Evidence Lineage Persistence & Isolation', () => {
  let { pool, prisma } = createPrismaClient();
  let store: PrismaEvidenceStore;
  let workStore: WorkStore;

  beforeEach(async () => {
    store = new PrismaEvidenceStore(prisma);
    workStore = new WorkStore(prisma);
    await prisma.completionDecision.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.artifactRecord.deleteMany();
    await prisma.attempt.deleteMany();
    await prisma.workItem.deleteMany();
    await prisma.projectEvent.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('durably persists and retrieves all P9 lineage fields for Artifact, Evidence, and Verification', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const attemptId = randomUUID();
    const approvalId = randomUUID();
    const completionDecisionId = randomUUID();
    const runId = 'run-lineage-001';
    const now = new Date('2026-09-04T22:00:00.000Z');

    const project = createProject({ id: projectId, slug: 'test-p9-lineage', name: 'Lineage Test', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'Test Lineage', now });
    await workStore.createWorkItem(workItem);

    // 1. ArtifactRecord with lineage
    const artifactInput: ArtifactRecord = {
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId,
      kind: 'PATCH',
      uri: 'git://patch/commit-123.diff',
      hash: 'sha256:abcd1234ef',
      producedBy: 'agent:coder',
      createdAt: now,
    };
    const savedArtifact = await store.saveArtifact(artifactInput);
    expect(savedArtifact).toMatchObject(artifactInput);
    expect(savedArtifact.digest).toBeDefined();
    expect(verifyArtifactIntegrity(savedArtifact)).toBe(true);

    // 2. EvidenceRecord with full lineage & digest
    const evidenceInput: EvidenceRecord = {
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId,
      approvalId,
      agentId: 'agent-reviewer-1',
      artifactId: savedArtifact.id,
      claim: 'All automated tests pass',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'vitest:suite-1',
      scmCommitSha: 'c748d54a71a66595d8cfef2914cda55736fac1b0',
      deploymentUri: 'https://staging.internal/p9-test',
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    };
    const savedEvidence = await store.saveEvidence(evidenceInput);
    expect(savedEvidence.runId).toBe(runId);
    expect(savedEvidence.attemptId).toBe(attemptId);
    expect(savedEvidence.approvalId).toBe(approvalId);
    expect(savedEvidence.agentId).toBe('agent-reviewer-1');
    expect(savedEvidence.artifactId).toBe(savedArtifact.id);
    expect(savedEvidence.scmCommitSha).toBe('c748d54a71a66595d8cfef2914cda55736fac1b0');
    expect(savedEvidence.deploymentUri).toBe('https://staging.internal/p9-test');
    expect(savedEvidence.digest).toBeDefined();
    expect(verifyEvidenceIntegrity(savedEvidence)).toBe(true);

    // 3. VerificationRecord with lineage & digest
    const verificationInput: VerificationRecord = {
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId,
      verificationType: 'TEST',
      status: 'PASS',
      evidenceIds: [savedEvidence.id],
      verifierRef: 'verifier:automated',
      completionDecisionId,
      verifiedAt: now,
      createdAt: now,
    };
    const savedVerification = await store.saveVerification(verificationInput);
    expect(savedVerification.runId).toBe(runId);
    expect(savedVerification.attemptId).toBe(attemptId);
    expect(savedVerification.completionDecisionId).toBe(completionDecisionId);
    expect(savedVerification.digest).toBeDefined();
    expect(verifyVerificationIntegrity(savedVerification)).toBe(true);

    // Retrieve via query methods
    const retrievedArtifact = await store.getArtifact(projectId, savedArtifact.id);
    expect(retrievedArtifact).toMatchObject(artifactInput);
    expect(retrievedArtifact?.digest).toBeDefined();
    expect(verifyArtifactIntegrity(retrievedArtifact!)).toBe(true);

    const retrievedArtifactList = await store.listArtifactsForWorkItem(projectId, workItemId);
    expect(retrievedArtifactList).toHaveLength(1);
    expect(retrievedArtifactList[0]).toMatchObject(artifactInput);
    expect(verifyArtifactIntegrity(retrievedArtifactList[0])).toBe(true);

    const retrievedEvidenceList = await store.listEvidenceForWorkItem(projectId, workItemId);
    expect(retrievedEvidenceList).toHaveLength(1);
    expect(retrievedEvidenceList[0].id).toBe(savedEvidence.id);
    expect(retrievedEvidenceList[0].runId).toBe(runId);

    const retrievedVerification = await store.getVerification(projectId, savedVerification.id);
    expect(retrievedVerification?.id).toBe(savedVerification.id);
    expect(retrievedVerification?.runId).toBe(runId);
  });

  it('enforces create-only writes: rejects duplicate record IDs and offers no mutable update path', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const runId = 'run-create-only-001';
    const now = new Date();

    const project = createProject({ id: projectId, slug: 'test-create-only', name: 'Create Only', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'Create Only', now });
    await workStore.createWorkItem(workItem);

    const evidenceId = randomUUID();
    const record: EvidenceRecord = {
      id: evidenceId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Initial claim',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'tool:1',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    };

    await store.saveEvidence(record);

    // Attempting to create duplicate ID must throw DuplicateRecordError
    await expect(
      store.saveEvidence({
        ...record,
        claim: 'Mutated claim attempt',
      })
    ).rejects.toThrow(DuplicateRecordError);

    // Artifact duplicate check
    const artifactId = randomUUID();
    const artifact: ArtifactRecord = {
      id: artifactId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      kind: 'FILE',
      uri: 'file://path',
      hash: null,
      producedBy: 'user',
      createdAt: now,
    };
    await store.saveArtifact(artifact);
    await expect(store.saveArtifact(artifact)).rejects.toThrow(DuplicateRecordError);

    // Verification duplicate check
    const verificationId = randomUUID();
    const verification: VerificationRecord = {
      id: verificationId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      verificationType: 'STATIC_CHECK',
      status: 'PASS',
      evidenceIds: [evidenceId],
      verifierRef: 'verifier:1',
      completionDecisionId: null,
      verifiedAt: now,
      createdAt: now,
    };
    await store.saveVerification(verification);
    await expect(store.saveVerification(verification)).rejects.toThrow(DuplicateRecordError);
  });

  it('detects tampering and throws EvidenceTamperedError when database row is mutated', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const runId = 'run-tamper-001';
    const now = new Date();

    const project = createProject({ id: projectId, slug: 'test-tamper', name: 'Tamper Test', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'Tamper Test', now });
    await workStore.createWorkItem(workItem);

    const evidenceId = randomUUID();
    await store.saveEvidence({
      id: evidenceId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Original authentic claim',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'tool:1',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    });

    // 1. Directly tamper with the database row (claim) bypassing the store
    await prisma.evidenceRecord.update({
      where: { id: evidenceId },
      data: { claim: 'TAMPERED: Fake claim injected directly into database' },
    });
    await expect(store.listEvidenceForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.getEvidence(projectId, evidenceId)).rejects.toThrow(EvidenceTamperedError);

    // 2. Direct DB mutation setting digest = null on EvidenceRecord
    await prisma.evidenceRecord.update({
      where: { id: evidenceId },
      data: { digest: null },
    });
    await expect(store.listEvidenceForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.getEvidence(projectId, evidenceId)).rejects.toThrow(EvidenceTamperedError);

    // 3. Direct creation of EvidenceRecord with digest = null in DB
    const nullDigestEvidenceId = randomUUID();
    await prisma.evidenceRecord.create({
      data: {
        id: nullDigestEvidenceId,
        projectId,
        runId,
        workItemId,
        claim: 'Evidence inserted directly with NULL digest',
        sourceType: 'TOOL_RESULT',
        sourceRef: 'raw-sql',
        currentness: 'CURRENT',
        digest: null,
        observedAt: now,
        createdAt: now,
      },
    });
    await expect(store.getEvidence(projectId, nullDigestEvidenceId)).rejects.toThrow(EvidenceTamperedError);

    // 4. VerificationRecord tampering & null digest
    const verificationId = randomUUID();
    await store.saveVerification({
      id: verificationId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      verificationType: 'TEST',
      status: 'PASS',
      evidenceIds: [evidenceId],
      verifierRef: 'verifier:1',
      completionDecisionId: null,
      verifiedAt: now,
      createdAt: now,
    });

    // Tampering verification status directly in DB
    await prisma.verificationRecord.update({
      where: { id: verificationId },
      data: { status: 'FAIL' },
    });
    await expect(store.getVerification(projectId, verificationId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listVerificationsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Direct DB mutation setting digest = null on VerificationRecord
    await prisma.verificationRecord.update({
      where: { id: verificationId },
      data: { digest: null },
    });
    await expect(store.getVerification(projectId, verificationId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listVerificationsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Direct creation of VerificationRecord with digest = null in DB
    const nullDigestVerificationId = randomUUID();
    await prisma.verificationRecord.create({
      data: {
        id: nullDigestVerificationId,
        projectId,
        runId,
        workItemId,
        verificationType: 'TEST',
        status: 'PASS',
        evidenceIds: [evidenceId],
        verifierRef: 'raw-verifier',
        digest: null,
        verifiedAt: now,
        createdAt: now,
      },
    });
    await expect(store.getVerification(projectId, nullDigestVerificationId)).rejects.toThrow(EvidenceTamperedError);

    // 5. ArtifactRecord tampering & null digest
    const artifactId = randomUUID();
    await store.saveArtifact({
      id: artifactId,
      projectId,
      runId,
      workItemId,
      attemptId: null,
      kind: 'FILE',
      uri: 'file://tamper.txt',
      hash: null,
      producedBy: 'agent:1',
      createdAt: now,
    });

    // Tampering artifact hash directly in DB
    await prisma.artifactRecord.update({
      where: { id: artifactId },
      data: { hash: 'TAMPERED_HASH' },
    });
    await expect(store.getArtifact(projectId, artifactId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listArtifactsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Tampering artifact uri directly in DB
    await prisma.artifactRecord.update({
      where: { id: artifactId },
      data: { hash: null, uri: 'file://tampered-uri.txt' },
    });
    await expect(store.getArtifact(projectId, artifactId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listArtifactsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Tampering artifact producedBy directly in DB
    await prisma.artifactRecord.update({
      where: { id: artifactId },
      data: { uri: 'file://tamper.txt', producedBy: 'rogue-agent' },
    });
    await expect(store.getArtifact(projectId, artifactId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listArtifactsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Direct DB mutation setting digest = null on ArtifactRecord
    await prisma.artifactRecord.update({
      where: { id: artifactId },
      data: { digest: null },
    });
    await expect(store.getArtifact(projectId, artifactId)).rejects.toThrow(EvidenceTamperedError);
    await expect(store.listArtifactsForWorkItem(projectId, workItemId)).rejects.toThrow(EvidenceTamperedError);

    // Direct creation of ArtifactRecord with digest = null in DB
    const nullDigestArtifactId = randomUUID();
    await prisma.artifactRecord.create({
      data: {
        id: nullDigestArtifactId,
        projectId,
        runId,
        workItemId,
        kind: 'FILE',
        uri: 'file://null-digest.txt',
        producedBy: 'raw-sql',
        digest: null,
        createdAt: now,
      },
    });
    await expect(store.getArtifact(projectId, nullDigestArtifactId)).rejects.toThrow(EvidenceTamperedError);
  });

  it('enforces cross-project and same-ID isolation against PostgreSQL', async () => {
    const project1Id = randomUUID();
    const project2Id = randomUUID();
    const sharedWorkItemId = randomUUID();
    const sharedRunId = 'run-isolation-shared';
    const now = new Date();

    const p1 = createProject({ id: project1Id, slug: 'proj-1', name: 'Project 1', now });
    const p2 = createProject({ id: project2Id, slug: 'proj-2', name: 'Project 2', now });
    await prisma.project.createMany({
      data: [
        { id: p1.id, slug: p1.slug, name: p1.name, createdAt: now, updatedAt: now },
        { id: p2.id, slug: p2.slug, name: p2.name, createdAt: now, updatedAt: now },
      ],
    });

    const w1 = createWorkItem({ id: sharedWorkItemId, projectId: project1Id, type: 'TASK', objective: 'W1', now });
    await workStore.createWorkItem(w1);

    const evidenceId = randomUUID();
    await store.saveEvidence({
      id: evidenceId,
      projectId: project1Id,
      runId: sharedRunId,
      workItemId: sharedWorkItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'P1 evidence',
      sourceType: 'AGENT_RESULT',
      sourceRef: 'agent:1',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    });

    // Project 2 query for the same workItemId or evidenceId must return empty/null
    const p2EvidenceList = await store.listEvidenceForWorkItem(project2Id, sharedWorkItemId);
    expect(p2EvidenceList).toHaveLength(0);

    const p2Evidence = await store.getEvidence(project2Id, evidenceId);
    expect(p2Evidence).toBeNull();

    const p2RunEvidence = await store.listEvidenceForRun(project2Id, sharedRunId);
    expect(p2RunEvidence).toHaveLength(0);

    // Cross-project same-ID collision attempt must be rejected by primary key isolation
    await expect(
      store.saveEvidence({
        id: evidenceId,
        projectId: project2Id,
        runId: sharedRunId,
        workItemId: sharedWorkItemId,
        attemptId: null,
        approvalId: null,
        agentId: null,
        artifactId: null,
        claim: 'Hijack attempt',
        sourceType: 'AGENT_RESULT',
        sourceRef: 'agent:2',
        scmCommitSha: null,
        deploymentUri: null,
        currentness: 'CURRENT',
        observedAt: now,
        createdAt: now,
      })
    ).rejects.toThrow(DuplicateRecordError);
  });

  it('enforces fail-closed currentness for STALE and INVALIDATED evidence', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const runId = 'run-currentness-001';
    const now = new Date();

    const project = createProject({ id: projectId, slug: 'test-currentness', name: 'Currentness Test', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'Currentness', now });
    await workStore.createWorkItem(workItem);

    const currentEvidence = await store.saveEvidence({
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Valid tests pass',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'tool:pass',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    });

    const staleEvidence = await store.saveEvidence({
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Old tests pass',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'tool:old',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'STALE',
      observedAt: now,
      createdAt: now,
    });

    const invalidatedEvidence = await store.saveEvidence({
      id: randomUUID(),
      projectId,
      runId,
      workItemId,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Flaky test invalidated',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'tool:invalid',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'INVALIDATED',
      observedAt: now,
      createdAt: now,
    });

    const makeVerification = (evIds: string[]): VerificationRecord => {
      const vInput = {
        id: randomUUID(),
        projectId,
        runId,
        workItemId,
        attemptId: null,
        verificationType: 'TEST' as const,
        status: 'PASS' as const,
        evidenceIds: evIds,
        verifierRef: 'verifier:1',
        completionDecisionId: null,
        verifiedAt: now,
      };
      return {
        ...vInput,
        digest: computeVerificationDigest(vInput),
        createdAt: now,
      };
    };

    // Stale evidence rejection
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId,
        workItemId,
        verification: makeVerification([staleEvidence.id]),
        evidence: [staleEvidence],
      })
    ).toThrow('is STALE, not CURRENT');

    // Invalidated evidence rejection
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId,
        workItemId,
        verification: makeVerification([invalidatedEvidence.id]),
        evidence: [invalidatedEvidence],
      })
    ).toThrow('is INVALIDATED, not CURRENT');

    // Current evidence acceptance
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId,
        workItemId,
        verification: makeVerification([currentEvidence.id]),
        evidence: [currentEvidence],
      })
    ).not.toThrow();

    // Rejects completion if CURRENT evidence is missing its digest (fail-closed)
    const currentNoDigest = { ...currentEvidence, digest: undefined };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId,
        workItemId,
        verification: makeVerification([currentNoDigest.id]),
        evidence: [currentNoDigest],
      })
    ).toThrow(EvidenceTamperedError);

    // Rejects completion if CURRENT evidence has tampered/mismatched digest
    const currentTampered = { ...currentEvidence, claim: 'tampered claim' };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId,
        workItemId,
        verification: makeVerification([currentTampered.id]),
        evidence: [currentTampered],
      })
    ).toThrow(EvidenceTamperedError);
  });

  it('fresh-process/reconnect test: proves stored lineage survives process restart and service reconstruction', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const attemptId = randomUUID();
    const approvalId = randomUUID();
    const completionDecisionId = randomUUID();
    const runId = 'run-reconnect-001';
    const now = new Date('2026-09-04T22:30:00.000Z');

    const project = createProject({ id: projectId, slug: 'test-reconnect', name: 'Reconnect Test', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'Reconnect Test', now });
    await workStore.createWorkItem(workItem);

    const artifactId = randomUUID();
    await store.saveArtifact({
      id: artifactId,
      projectId,
      runId,
      workItemId,
      attemptId,
      kind: 'LOG',
      uri: 'file://execution.log',
      hash: 'sha256:loghash',
      producedBy: 'system',
      createdAt: now,
    });

    const evidenceId = randomUUID();
    await store.saveEvidence({
      id: evidenceId,
      projectId,
      runId,
      workItemId,
      attemptId,
      approvalId,
      agentId: 'agent-reconnect',
      artifactId,
      claim: 'Persisted across reconnection',
      sourceType: 'VERIFICATION',
      sourceRef: 'check:1',
      scmCommitSha: 'c748d54a71a66595d8cfef2914cda55736fac1b0',
      deploymentUri: 'https://orchestrator.internal/runs/1',
      currentness: 'CURRENT',
      observedAt: now,
      createdAt: now,
    });

    const verificationId = randomUUID();
    await store.saveVerification({
      id: verificationId,
      projectId,
      runId,
      workItemId,
      attemptId,
      verificationType: 'BEHAVIORAL_CHECK',
      status: 'PASS',
      evidenceIds: [evidenceId],
      verifierRef: 'verifier:reconnect',
      completionDecisionId,
      verifiedAt: now,
      createdAt: now,
    });

    // Disconnect and tear down the current Prisma client and store
    await prisma.$disconnect();
    await pool.end();

    // Reconstruct completely fresh connection, Prisma client, and store (simulating process restart)
    const freshConn = createPrismaClient();
    try {
      const freshStore = new PrismaEvidenceStore(freshConn.prisma);

      const reconnectedArtifact = await freshStore.getArtifact(projectId, artifactId);
      expect(reconnectedArtifact).not.toBeNull();
      expect(reconnectedArtifact?.runId).toBe(runId);
      expect(reconnectedArtifact?.attemptId).toBe(attemptId);
      expect(reconnectedArtifact?.hash).toBe('sha256:loghash');
      expect(reconnectedArtifact?.digest).toBeDefined();
      expect(verifyArtifactIntegrity(reconnectedArtifact!)).toBe(true);

      const reconnectedEvidence = await freshStore.getEvidence(projectId, evidenceId);
      expect(reconnectedEvidence).not.toBeNull();
      expect(reconnectedEvidence?.runId).toBe(runId);
      expect(reconnectedEvidence?.attemptId).toBe(attemptId);
      expect(reconnectedEvidence?.approvalId).toBe(approvalId);
      expect(reconnectedEvidence?.agentId).toBe('agent-reconnect');
      expect(reconnectedEvidence?.artifactId).toBe(artifactId);
      expect(reconnectedEvidence?.scmCommitSha).toBe('c748d54a71a66595d8cfef2914cda55736fac1b0');
      expect(reconnectedEvidence?.deploymentUri).toBe('https://orchestrator.internal/runs/1');
      expect(reconnectedEvidence?.digest).toBeDefined();
      expect(verifyEvidenceIntegrity(reconnectedEvidence!)).toBe(true);

      const reconnectedVerification = await freshStore.getVerification(projectId, verificationId);
      expect(reconnectedVerification).not.toBeNull();
      expect(reconnectedVerification?.runId).toBe(runId);
      expect(reconnectedVerification?.attemptId).toBe(attemptId);
      expect(reconnectedVerification?.completionDecisionId).toBe(completionDecisionId);
      expect(reconnectedVerification?.digest).toBeDefined();
      expect(verifyVerificationIntegrity(reconnectedVerification!)).toBe(true);
    } finally {
      await freshConn.prisma.$disconnect();
      await freshConn.pool.end();
      // Reconnect original client for afterAll
      const re = createPrismaClient();
      pool = re.pool;
      prisma = re.prisma;
    }
  });

  it('integrates cleanly with EvidenceVerificationService to drive durable WorkItem completion', async () => {
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const runId = 'run-service-e2e';
    const now = new Date();

    const project = createProject({ id: projectId, slug: 'test-service-e2e', name: 'Service E2E', now });
    await prisma.project.create({ data: { id: project.id, slug: project.slug, name: project.name, createdAt: now, updatedAt: now } });
    const workItem = createWorkItem({ id: workItemId, projectId, type: 'TASK', objective: 'E2E test', now });
    const createdItem = await workStore.createWorkItem(workItem);

    // Transition work item along canonical lifecycle to VERIFICATION_REQUIRED
    const s1 = await workStore.transitionWorkItem({
      workItemId: createdItem.id,
      expectedRevision: createdItem.revision,
      to: 'READY',
    });
    const s2 = await workStore.transitionWorkItem({
      workItemId: s1.id,
      expectedRevision: s1.revision,
      to: 'ASSIGNED',
    });
    const s3 = await workStore.transitionWorkItem({
      workItemId: s2.id,
      expectedRevision: s2.revision,
      to: 'RUNNING',
    });
    const readyItem = await workStore.transitionWorkItem({
      workItemId: s3.id,
      expectedRevision: s3.revision,
      to: 'VERIFICATION_REQUIRED',
    });

    const service = new EvidenceVerificationService(store, workStore);

    // Register evidence through service
    const evidence = await service.registerEvidence({
      projectId,
      runId,
      workItemId: readyItem.id,
      attemptId: null,
      approvalId: null,
      agentId: 'agent:e2e',
      artifactId: null,
      claim: 'E2E test suite passed cleanly',
      sourceType: 'TOOL_RESULT',
      sourceRef: 'vitest:p9-s2a',
      scmCommitSha: 'c748d54a71a66595d8cfef2914cda55736fac1b0',
      deploymentUri: null,
      currentness: 'CURRENT',
      observedAt: now,
    });

    // Record verification and resolve
    const { verification, workItem: completedItem } = await service.recordVerificationAndResolve({
      workItem: readyItem,
      runId,
      verificationType: 'TEST',
      status: 'PASS',
      evidenceIds: [evidence.id],
      verifierRef: 'verifier:e2e-runner',
    });

    expect(verification.status).toBe('PASS');
    expect(completedItem.lifecycleState).toBe('COMPLETED');
    expect(completedItem.revision).toBe(readyItem.revision + 1);

    // Confirm state in PostgreSQL
    const persistedItem = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(persistedItem.lifecycleState).toBe('COMPLETED');
    expect(persistedItem.revision).toBe(completedItem.revision);
  });
});
