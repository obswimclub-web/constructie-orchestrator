import { describe, it, expect } from 'vitest';
import {
  computeArtifactDigest,
  verifyArtifactIntegrity,
  computeEvidenceDigest,
  verifyEvidenceIntegrity,
  computeVerificationDigest,
  verifyVerificationIntegrity,
  assertVerificationCanCompleteWorkItem,
  EvidenceTamperedError,
  VerificationEvidenceError,
  type ArtifactRecord,
  type EvidenceRecord,
  type VerificationRecord,
} from './records.js';

describe('Evidence & Verification Records — Unit Tests', () => {
  const now = new Date('2026-09-04T22:00:00.000Z');

  it('computes deterministic artifact digest and verifies integrity', () => {
    const baseInput = {
      id: 'a1',
      projectId: 'p1',
      runId: 'r1',
      workItemId: 'w1',
      attemptId: null,
      kind: 'FILE' as const,
      uri: 'file://repo/patch.diff',
      hash: 'sha256:abc',
      producedBy: 'agent:1',
      createdAt: now,
    };
    const digest1 = computeArtifactDigest(baseInput);
    const digest2 = computeArtifactDigest(baseInput);
    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64);

    const validRecord: ArtifactRecord = {
      ...baseInput,
      digest: digest1,
    };
    expect(verifyArtifactIntegrity(validRecord)).toBe(true);

    // Tampered kind
    const tamperedKindRecord: ArtifactRecord = {
      ...validRecord,
      kind: 'PATCH',
    };
    expect(verifyArtifactIntegrity(tamperedKindRecord)).toBe(false);

    // Tampered hash
    const tamperedHashRecord: ArtifactRecord = {
      ...validRecord,
      hash: 'sha256:tampered',
    };
    expect(verifyArtifactIntegrity(tamperedHashRecord)).toBe(false);

    // Tampered uri
    const tamperedUriRecord: ArtifactRecord = {
      ...validRecord,
      uri: 'file://repo/altered.diff',
    };
    expect(verifyArtifactIntegrity(tamperedUriRecord)).toBe(false);

    // Missing digest
    const noDigestRecord: ArtifactRecord = {
      ...validRecord,
      digest: undefined,
    };
    expect(verifyArtifactIntegrity(noDigestRecord)).toBe(false);
  });

  it('computes deterministic evidence digest and verifies integrity', () => {
    const baseInput = {
      id: 'e1',
      projectId: 'p1',
      runId: 'r1',
      workItemId: 'w1',
      claim: 'All tests pass',
      sourceType: 'TOOL_RESULT' as const,
      sourceRef: 'vitest',
      currentness: 'CURRENT' as const,
      observedAt: now,
    };
    const digest1 = computeEvidenceDigest(baseInput);
    const digest2 = computeEvidenceDigest(baseInput);
    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64);

    const validRecord: EvidenceRecord = {
      ...baseInput,
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      scmCommitSha: null,
      deploymentUri: null,
      digest: digest1,
      createdAt: now,
    };
    expect(verifyEvidenceIntegrity(validRecord)).toBe(true);

    // Tampered record
    const tamperedRecord: EvidenceRecord = {
      ...validRecord,
      claim: 'Altered claim',
    };
    expect(verifyEvidenceIntegrity(tamperedRecord)).toBe(false);

    // Missing digest
    const noDigestRecord: EvidenceRecord = {
      ...validRecord,
      digest: undefined,
    };
    expect(verifyEvidenceIntegrity(noDigestRecord)).toBe(false);
  });

  it('computes deterministic verification digest and verifies integrity', () => {
    const baseInput = {
      id: 'v1',
      projectId: 'p1',
      runId: 'r1',
      workItemId: 'w1',
      attemptId: null,
      verificationType: 'TEST' as const,
      status: 'PASS' as const,
      evidenceIds: ['e2', 'e1'], // unordered to test sorting
      verifierRef: 'verifier:automated',
      completionDecisionId: null,
      verifiedAt: now,
    };
    const digest1 = computeVerificationDigest(baseInput);
    const digest2 = computeVerificationDigest({ ...baseInput, evidenceIds: ['e1', 'e2'] });
    expect(digest1).toBe(digest2);

    const validRecord: VerificationRecord = {
      ...baseInput,
      digest: digest1,
      createdAt: now,
    };
    expect(verifyVerificationIntegrity(validRecord)).toBe(true);

    const tamperedRecord: VerificationRecord = {
      ...validRecord,
      status: 'FAIL',
    };
    expect(verifyVerificationIntegrity(tamperedRecord)).toBe(false);
  });

  it('assertVerificationCanCompleteWorkItem validates integrity and detects tampering', () => {
    const evidenceInput = {
      id: 'e1',
      projectId: 'p1',
      runId: 'r1',
      workItemId: 'w1',
      attemptId: null,
      approvalId: null,
      agentId: null,
      artifactId: null,
      claim: 'Passes',
      sourceType: 'TOOL_RESULT' as const,
      sourceRef: 'tool:1',
      scmCommitSha: null,
      deploymentUri: null,
      currentness: 'CURRENT' as const,
      observedAt: now,
      createdAt: now,
    };
    const validDigest = computeEvidenceDigest(evidenceInput);
    const validEvidence: EvidenceRecord = { ...evidenceInput, digest: validDigest };

    const verificationInput = {
      id: 'v1',
      projectId: 'p1',
      runId: 'r1',
      workItemId: 'w1',
      attemptId: null,
      verificationType: 'TEST' as const,
      status: 'PASS' as const,
      evidenceIds: ['e1'],
      verifierRef: 'verifier:1',
      completionDecisionId: null,
      verifiedAt: now,
    };
    const verification: VerificationRecord = {
      ...verificationInput,
      digest: computeVerificationDigest(verificationInput),
      createdAt: now,
    };

    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p1',
        workItemId: 'w1',
        verification,
        evidence: [validEvidence],
      })
    ).not.toThrow();

    // Missing evidence digest on CURRENT evidence must fail closed
    const noDigestEvidence: EvidenceRecord = {
      ...validEvidence,
      digest: undefined,
    };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p1',
        workItemId: 'w1',
        verification,
        evidence: [noDigestEvidence],
      })
    ).toThrow(EvidenceTamperedError);

    // Tampered evidence
    const tamperedEvidence: EvidenceRecord = {
      ...validEvidence,
      claim: 'Tampered claim text',
    };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p1',
        workItemId: 'w1',
        verification,
        evidence: [tamperedEvidence],
      })
    ).toThrow(EvidenceTamperedError);

    // Scope mismatch
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p2',
        workItemId: 'w1',
        verification,
        evidence: [validEvidence],
      })
    ).toThrow(VerificationEvidenceError);


    // Missing/null/empty/tampered evidence digest must fail closed
    for (const invalidDigest of [undefined, null, '', '   ', 'tampered-digest']) {
      const badEvidence: EvidenceRecord = {
        ...validEvidence,
        digest: invalidDigest as string | null | undefined,
      };
      expect(() =>
        assertVerificationCanCompleteWorkItem({
          projectId: 'p1',
          workItemId: 'w1',
          verification: verification,
          evidence: [badEvidence],
        })
      ).toThrow(EvidenceTamperedError);
    }

    // Missing/null/empty/tampered verification digest must fail closed
    for (const invalidDigest of [undefined, null, '', '   ', 'tampered-digest']) {
      const badVerification: VerificationRecord = {
        ...verification,
        digest: invalidDigest as string | null | undefined,
      };
      expect(() =>
        assertVerificationCanCompleteWorkItem({
          projectId: 'p1',
          workItemId: 'w1',
          verification: badVerification,
          evidence: [validEvidence],
        })
      ).toThrow(EvidenceTamperedError);
    }

    // Non-verifier:1 verification and evidence missing digest must both fail closed (throw EvidenceTamperedError)
    const nonVerifier1 = 'verifier:custom-runner-non-default';
    const nonVerifier1VerificationMissingDigest: VerificationRecord = {
      ...verification,
      verifierRef: nonVerifier1,
      digest: undefined,
    };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p1',
        workItemId: 'w1',
        verification: nonVerifier1VerificationMissingDigest,
        evidence: [validEvidence],
      })
    ).toThrow(EvidenceTamperedError);

    const nonVerifier1VerificationValid: VerificationRecord = {
      ...verification,
      verifierRef: nonVerifier1,
      digest: computeVerificationDigest({
        ...verification,
        verifierRef: nonVerifier1,
      }),
    };
    const evidenceMissingDigest: EvidenceRecord = {
      ...validEvidence,
      digest: undefined,
    };
    expect(() =>
      assertVerificationCanCompleteWorkItem({
        projectId: 'p1',
        workItemId: 'w1',
        verification: nonVerifier1VerificationValid,
        evidence: [evidenceMissingDigest],
      })
    ).toThrow(EvidenceTamperedError);
  });
});
