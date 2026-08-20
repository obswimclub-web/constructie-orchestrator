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
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly kind: ArtifactKind;
  readonly uri: string;
  readonly hash: string | null;
  readonly producedBy: string;
  readonly createdAt: Date;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly artifactId: string | null;
  readonly claim: string;
  readonly sourceType: 'AGENT_RESULT' | 'TOOL_RESULT' | 'VERIFICATION';
  readonly sourceRef: string;
  readonly currentness: EvidenceCurrentness;
  readonly observedAt: Date;
  readonly createdAt: Date;
}

export interface VerificationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly verificationType: 'TEST' | 'STATIC_CHECK' | 'BEHAVIORAL_CHECK' | 'MANUAL_RULE';
  readonly status: VerificationStatus;
  readonly evidenceIds: readonly string[];
  readonly verifierRef: string;
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
  }
}
