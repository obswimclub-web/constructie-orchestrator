import type { PrismaClient } from "@prisma/client";
import {
  type ArtifactRecord,
  type EvidenceRecord,
  type VerificationRecord,
  type EvidenceStore,
  type ArtifactKind,
  type EvidenceCurrentness,
  type VerificationStatus,
  computeEvidenceDigest,
  verifyEvidenceIntegrity,
  computeVerificationDigest,
  verifyVerificationIntegrity,
  EvidenceTamperedError,
  computeArtifactDigest,
  verifyArtifactIntegrity,
} from "@co/evidence";

export class DuplicateRecordError extends Error {
  public readonly code = "DUPLICATE_RECORD";
  public constructor(public readonly recordType: string, public readonly id: string) {
    super(`${recordType} with ID ${id} already exists.`);
    this.name = "DuplicateRecordError";
  }
}

export class PrismaEvidenceStore implements EvidenceStore {
  public constructor(private readonly prisma: PrismaClient) {}

  /**
   * CREATE-ONLY: saves an artifact record. Throws DuplicateRecordError if ID already exists.
   */
  public async saveArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    try {
      const digest = record.digest ?? computeArtifactDigest(record);
      const row = await this.prisma.artifactRecord.create({
        data: {
          id: record.id,
          projectId: record.projectId,
          runId: record.runId,
          workItemId: record.workItemId,
          attemptId: record.attemptId ?? null,
          kind: record.kind,
          uri: record.uri,
          hash: record.hash ?? null,
          producedBy: record.producedBy,
          createdAt: record.createdAt,
          digest,
        },
      });
      return {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        kind: row.kind as ArtifactKind,
        uri: row.uri,
        hash: row.hash,
        producedBy: row.producedBy,
        digest: row.digest,
        createdAt: row.createdAt,
      };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        throw new DuplicateRecordError("ArtifactRecord", record.id);
      }
      throw err;
    }
  }

  /**
   * CREATE-ONLY: saves an evidence record with deterministic integrity digest. Throws DuplicateRecordError if ID already exists.
   */
  public async saveEvidence(record: EvidenceRecord): Promise<EvidenceRecord> {
    const digest = record.digest ?? computeEvidenceDigest(record);
    try {
      const row = await this.prisma.evidenceRecord.create({
        data: {
          id: record.id,
          projectId: record.projectId,
          runId: record.runId,
          workItemId: record.workItemId,
          attemptId: record.attemptId ?? null,
          approvalId: record.approvalId ?? null,
          agentId: record.agentId ?? null,
          artifactId: record.artifactId ?? null,
          claim: record.claim,
          sourceType: record.sourceType,
          sourceRef: record.sourceRef,
          scmCommitSha: record.scmCommitSha ?? null,
          deploymentUri: record.deploymentUri ?? null,
          currentness: record.currentness,
          digest,
          observedAt: record.observedAt,
          createdAt: record.createdAt,
        },
      });
      return {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        approvalId: row.approvalId,
        agentId: row.agentId,
        artifactId: row.artifactId,
        claim: row.claim,
        sourceType: row.sourceType as EvidenceRecord["sourceType"],
        sourceRef: row.sourceRef,
        scmCommitSha: row.scmCommitSha,
        deploymentUri: row.deploymentUri,
        currentness: row.currentness as EvidenceCurrentness,
        digest: row.digest,
        observedAt: row.observedAt,
        createdAt: row.createdAt,
      };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        throw new DuplicateRecordError("EvidenceRecord", record.id);
      }
      throw err;
    }
  }

  /**
   * CREATE-ONLY: saves a verification record with deterministic integrity digest. Throws DuplicateRecordError if ID already exists.
   */
  public async saveVerification(record: VerificationRecord): Promise<VerificationRecord> {
    const digest = record.digest ?? computeVerificationDigest(record);
    try {
      const row = await this.prisma.verificationRecord.create({
        data: {
          id: record.id,
          projectId: record.projectId,
          runId: record.runId,
          workItemId: record.workItemId,
          attemptId: record.attemptId ?? null,
          verificationType: record.verificationType,
          status: record.status,
          evidenceIds: [...record.evidenceIds],
          verifierRef: record.verifierRef,
          completionDecisionId: record.completionDecisionId ?? null,
          digest,
          verifiedAt: record.verifiedAt,
          createdAt: record.createdAt,
        },
      });
      return {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        verificationType: row.verificationType as VerificationRecord["verificationType"],
        status: row.status as VerificationStatus,
        evidenceIds: (row.evidenceIds as unknown) as string[],
        verifierRef: row.verifierRef,
        completionDecisionId: row.completionDecisionId,
        digest: row.digest,
        verifiedAt: row.verifiedAt,
        createdAt: row.createdAt,
      };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        throw new DuplicateRecordError("VerificationRecord", record.id);
      }
      throw err;
    }
  }

  /**
   * Project-scoped read: lists evidence for a work item, enforcing fail-closed digest integrity.
   */
  public async listEvidenceForWorkItem(projectId: string, workItemId: string): Promise<readonly EvidenceRecord[]> {
    const rows = await this.prisma.evidenceRecord.findMany({
      where: { projectId, workItemId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const record: EvidenceRecord = {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        approvalId: row.approvalId,
        agentId: row.agentId,
        artifactId: row.artifactId,
        claim: row.claim,
        sourceType: row.sourceType as EvidenceRecord["sourceType"],
        sourceRef: row.sourceRef,
        scmCommitSha: row.scmCommitSha,
        deploymentUri: row.deploymentUri,
        currentness: row.currentness as EvidenceCurrentness,
        digest: row.digest,
        observedAt: row.observedAt,
        createdAt: row.createdAt,
      };
      if (!record.digest || !verifyEvidenceIntegrity(record)) {
        throw new EvidenceTamperedError(`Persisted evidence ${record.id} failed integrity verification: missing or invalid digest.`);
      }
      return record;
    });
  }

  /**
   * Project-scoped read: gets a single evidence record by id, enforcing fail-closed digest integrity.
   */
  public async getEvidence(projectId: string, evidenceId: string): Promise<EvidenceRecord | null> {
    const row = await this.prisma.evidenceRecord.findFirst({
      where: { id: evidenceId, projectId },
    });
    if (!row) return null;
    const record: EvidenceRecord = {
      id: row.id,
      projectId: row.projectId,
      runId: row.runId,
      workItemId: row.workItemId,
      attemptId: row.attemptId,
      approvalId: row.approvalId,
      agentId: row.agentId,
      artifactId: row.artifactId,
      claim: row.claim,
      sourceType: row.sourceType as EvidenceRecord["sourceType"],
      sourceRef: row.sourceRef,
      scmCommitSha: row.scmCommitSha,
      deploymentUri: row.deploymentUri,
      currentness: row.currentness as EvidenceCurrentness,
      digest: row.digest,
      observedAt: row.observedAt,
      createdAt: row.createdAt,
    };
    if (!record.digest || !verifyEvidenceIntegrity(record)) {
      throw new EvidenceTamperedError(`Persisted evidence ${record.id} failed integrity verification: missing or invalid digest.`);
    }
    return record;
  }

  /**
   * Project-scoped read: gets a single artifact record by id.
   */
  public async getArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord | null> {
    const row = await this.prisma.artifactRecord.findFirst({
      where: { id: artifactId, projectId },
    });
    if (!row) return null;
    const record: ArtifactRecord = {
      id: row.id,
      projectId: row.projectId,
      runId: row.runId,
      workItemId: row.workItemId,
      attemptId: row.attemptId,
      kind: row.kind as ArtifactKind,
      uri: row.uri,
      hash: row.hash,
      producedBy: row.producedBy,
      digest: row.digest,
      createdAt: row.createdAt,
    };
    if (!record.digest || !verifyArtifactIntegrity(record)) {
      throw new EvidenceTamperedError(`Persisted artifact ${record.id} failed integrity verification: missing or invalid digest.`);
    }
    return record;
  }

  /**
   * Project-scoped read: gets a single verification record by id, enforcing fail-closed digest integrity.
   */
  public async getVerification(projectId: string, verificationId: string): Promise<VerificationRecord | null> {
    const row = await this.prisma.verificationRecord.findFirst({
      where: { id: verificationId, projectId },
    });
    if (!row) return null;
    const record: VerificationRecord = {
      id: row.id,
      projectId: row.projectId,
      runId: row.runId,
      workItemId: row.workItemId,
      attemptId: row.attemptId,
      verificationType: row.verificationType as VerificationRecord["verificationType"],
      status: row.status as VerificationStatus,
      evidenceIds: (row.evidenceIds as unknown) as string[],
      verifierRef: row.verifierRef,
      completionDecisionId: row.completionDecisionId,
      digest: row.digest,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
    };
    if (!record.digest || !verifyVerificationIntegrity(record)) {
      throw new EvidenceTamperedError(`Persisted verification ${record.id} failed integrity verification: missing or invalid digest.`);
    }
    return record;
  }

  /**
   * Project-scoped read: lists artifacts for a work item.
   */
  public async listArtifactsForWorkItem(projectId: string, workItemId: string): Promise<readonly ArtifactRecord[]> {
    const rows = await this.prisma.artifactRecord.findMany({
      where: { projectId, workItemId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const record: ArtifactRecord = {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        kind: row.kind as ArtifactKind,
        uri: row.uri,
        hash: row.hash,
        producedBy: row.producedBy,
        digest: row.digest,
        createdAt: row.createdAt,
      };
      if (!record.digest || !verifyArtifactIntegrity(record)) {
        throw new EvidenceTamperedError(`Persisted artifact ${record.id} failed integrity verification: missing or invalid digest.`);
      }
      return record;
    });
  }

  /**
   * Project-scoped read: lists verifications for a work item, enforcing fail-closed digest integrity.
   */
  public async listVerificationsForWorkItem(projectId: string, workItemId: string): Promise<readonly VerificationRecord[]> {
    const rows = await this.prisma.verificationRecord.findMany({
      where: { projectId, workItemId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const record: VerificationRecord = {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        verificationType: row.verificationType as VerificationRecord["verificationType"],
        status: row.status as VerificationStatus,
        evidenceIds: (row.evidenceIds as unknown) as string[],
        verifierRef: row.verifierRef,
        completionDecisionId: row.completionDecisionId,
        digest: row.digest,
        verifiedAt: row.verifiedAt,
        createdAt: row.createdAt,
      };
      if (!record.digest || !verifyVerificationIntegrity(record)) {
        throw new EvidenceTamperedError(`Persisted verification ${record.id} failed integrity verification: missing or invalid digest.`);
      }
      return record;
    });
  }

  /**
   * Project-scoped read: lists evidence for a run, enforcing fail-closed digest integrity.
   */
  public async listEvidenceForRun(projectId: string, runId: string): Promise<readonly EvidenceRecord[]> {
    const rows = await this.prisma.evidenceRecord.findMany({
      where: { projectId, runId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const record: EvidenceRecord = {
        id: row.id,
        projectId: row.projectId,
        runId: row.runId,
        workItemId: row.workItemId,
        attemptId: row.attemptId,
        approvalId: row.approvalId,
        agentId: row.agentId,
        artifactId: row.artifactId,
        claim: row.claim,
        sourceType: row.sourceType as EvidenceRecord["sourceType"],
        sourceRef: row.sourceRef,
        scmCommitSha: row.scmCommitSha,
        deploymentUri: row.deploymentUri,
        currentness: row.currentness as EvidenceCurrentness,
        digest: row.digest,
        observedAt: row.observedAt,
        createdAt: row.createdAt,
      };
      if (!record.digest || !verifyEvidenceIntegrity(record)) {
        throw new EvidenceTamperedError(`Persisted evidence ${record.id} failed integrity verification: missing or invalid digest.`);
      }
      return record;
    });
  }
}
