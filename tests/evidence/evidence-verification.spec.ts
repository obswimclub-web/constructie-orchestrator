import { describe, expect, it } from 'vitest';
import {
  assertVerificationCanCompleteWorkItem,
  computeEvidenceDigest,
  computeVerificationDigest,
  type EvidenceRecord,
  type VerificationRecord,
} from '@co/evidence';

const now = new Date('2026-08-20T12:00:00.000Z');
const baseEvidence = {
  id: 'e1', runId: 'r1', projectId: 'p1', workItemId: 'w1', artifactId: 'a1', claim: 'tests passed',
  sourceType: 'TOOL_RESULT' as const, sourceRef: 'tool-1', currentness: 'CURRENT' as const, observedAt: now, createdAt: now,
};
const evidence: EvidenceRecord = {
  ...baseEvidence,
  digest: computeEvidenceDigest(baseEvidence),
};
const baseVerification = {
  id: 'v1', runId: 'r1', projectId: 'p1', workItemId: 'w1', verificationType: 'TEST' as const, status: 'PASS' as const,
  evidenceIds: ['e1'], verifierRef: 'verifier:test', verifiedAt: now, createdAt: now,
};
const verification: VerificationRecord = {
  ...baseVerification,
  digest: computeVerificationDigest(baseVerification),
};

describe('evidence-bound completion', () => {
  it('accepts PASS only with current evidence in the same scope', () => {
    expect(() => assertVerificationCanCompleteWorkItem({ projectId: 'p1', workItemId: 'w1', verification, evidence: [evidence] })).not.toThrow();
  });

  it('rejects PASS with stale evidence', () => {
    expect(() => assertVerificationCanCompleteWorkItem({ projectId: 'p1', workItemId: 'w1', verification, evidence: [{ ...evidence, currentness: 'STALE' }] })).toThrow('not CURRENT');
  });

  it('rejects PASS without evidence', () => {
    expect(() => assertVerificationCanCompleteWorkItem({ projectId: 'p1', workItemId: 'w1', verification: { ...verification, evidenceIds: [] }, evidence: [] })).toThrow('at least one');
  });
});
