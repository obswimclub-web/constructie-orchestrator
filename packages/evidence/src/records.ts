
import { createHash } from 'node:crypto';

export const ARTIFACT_KINDS = [
  'PATCH',
  'FILE',
  'TEST_REPORT',
  'COMMAND_OUTPUT',
  'LOG',
  'OTHER',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const EVIDENCE_STATUSES = [
  'CURRENT',
  'STALE',
  'INVALIDATED',
] as const;
export type EvidenceCurrentness = (typeof EVIDENCE_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'PASS',
  'FAIL',
  'INCONCLUSIVE',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface ArtifactRecord {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly kind: ArtifactKind;
  readonly uri: string;
  readonly hash: string | null;
  readonly producedBy: string;
  readonly digest?: string | null | undefined;
  readonly createdAt: Date;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly approvalId: string | null;
  readonly agentId: string | null;
  readonly artifactId: string | null;
  readonly claim: string;
  readonly sourceType: 'AGENT_RESULT' | 'TOOL_RESULT' | 'VERIFICATION';
  readonly sourceRef: string;
  readonly scmCommitSha: string | null;
  readonly deploymentUri: string | null;
  readonly currentness: EvidenceCurrentness;
  readonly digest?: string | null | undefined;
  readonly observedAt: Date;
  readonly createdAt: Date;
}

export interface VerificationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly verificationType: 'TEST' | 'STATIC_CHECK' | 'BEHAVIORAL_CHECK' | 'MANUAL_RULE';
  readonly status: VerificationStatus;
  readonly evidenceIds: readonly string[];
  readonly verifierRef: string;
  readonly completionDecisionId: string | null;
  readonly digest?: string | null | undefined;
  readonly verifiedAt: Date;
  readonly createdAt: Date;
}

export class VerificationEvidenceError extends Error {
  public readonly code = 'VERIFICATION_EVIDENCE_INVALID';
  public constructor(message: string) {
    super(message);
    this.name = 'VerificationEvidenceError';
  }
}

export class EvidenceTamperedError extends Error {
  public readonly code = 'EVIDENCE_TAMPERED';
  public constructor(message: string) {
    super(message);
    this.name = 'EvidenceTamperedError';
  }
}

export function computeArtifactDigest(record: {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId?: string | null;
  readonly kind: string;
  readonly uri: string;
  readonly hash?: string | null;
  readonly producedBy: string;
  readonly createdAt?: Date | string;
}): string {
  const payload = JSON.stringify({
    id: record.id,
    projectId: record.projectId,
    runId: record.runId,
    workItemId: record.workItemId,
    attemptId: record.attemptId ?? null,
    kind: record.kind,
    uri: record.uri,
    hash: record.hash ?? null,
    producedBy: record.producedBy,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : (record.createdAt ?? null),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyArtifactIntegrity(record: ArtifactRecord): boolean {
  if (!record.digest) return false;
  return record.digest === computeArtifactDigest(record);
}


export function computeEvidenceDigest(record: {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId?: string | null;
  readonly approvalId?: string | null;
  readonly agentId?: string | null;
  readonly artifactId?: string | null;
  readonly claim: string;
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly scmCommitSha?: string | null;
  readonly deploymentUri?: string | null;
  readonly currentness: string;
  readonly observedAt: Date | string;
}): string {
  const payload = JSON.stringify({
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
    observedAt: record.observedAt instanceof Date ? record.observedAt.toISOString() : record.observedAt,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyEvidenceIntegrity(record: EvidenceRecord): boolean {
  if (!record.digest) return false;
  return record.digest === computeEvidenceDigest(record);
}

export function computeVerificationDigest(record: {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly attemptId?: string | null;
  readonly verificationType: string;
  readonly status: string;
  readonly evidenceIds: readonly string[];
  readonly verifierRef: string;
  readonly completionDecisionId?: string | null;
  readonly verifiedAt: Date | string;
}): string {
  const payload = JSON.stringify({
    id: record.id,
    projectId: record.projectId,
    runId: record.runId,
    workItemId: record.workItemId,
    attemptId: record.attemptId ?? null,
    verificationType: record.verificationType,
    status: record.status,
    evidenceIds: [...record.evidenceIds].sort(),
    verifierRef: record.verifierRef,
    completionDecisionId: record.completionDecisionId ?? null,
    verifiedAt: record.verifiedAt instanceof Date ? record.verifiedAt.toISOString() : record.verifiedAt,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyVerificationIntegrity(record: VerificationRecord): boolean {
  if (!record.digest) return false;
  return record.digest === computeVerificationDigest(record);
}

export function assertVerificationCanCompleteWorkItem(input: {
  readonly projectId: string;
  readonly workItemId: string;
  readonly verification: VerificationRecord;
  readonly evidence: readonly EvidenceRecord[];
}): void {
  const { verification } = input;
  if (verification.projectId !== input.projectId || verification.workItemId !== input.workItemId) {
    throw new VerificationEvidenceError('Verification scope does not match the target WorkItem.');
  }
  if (verification.status !== 'PASS') {
    throw new VerificationEvidenceError(`Verification must be PASS; received ${verification.status}.`);
  }
  if (verification.evidenceIds.length === 0) {
    throw new VerificationEvidenceError('PASS verification must reference at least one EvidenceRecord.');
  }
  if (verification.digest && !verifyVerificationIntegrity(verification)) {
    throw new EvidenceTamperedError(`Verification ${verification.id} integrity verification failed: digest mismatch.`);
  }
  const evidenceById = new Map(input.evidence.map((record) => [record.id, record]));
  for (const evidenceId of verification.evidenceIds) {
    const record = evidenceById.get(evidenceId);
    if (!record) throw new VerificationEvidenceError(`Evidence ${evidenceId} is missing.`);
    if (record.projectId !== input.projectId || record.workItemId !== input.workItemId) {
      throw new VerificationEvidenceError(`Evidence ${evidenceId} is outside the WorkItem scope.`);
    }
    if (record.currentness !== 'CURRENT') {
      throw new VerificationEvidenceError(`Evidence ${evidenceId} is ${record.currentness}, not CURRENT.`);
    }
    if (verification.digest || record.digest !== undefined) {
      if (!record.digest || !verifyEvidenceIntegrity(record)) {
        throw new EvidenceTamperedError(
          `Evidence ${evidenceId} integrity verification failed: missing or invalid digest.`
        );
      }
    }
  }
}
