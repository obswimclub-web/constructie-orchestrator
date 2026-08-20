import { describe, expect, it } from 'vitest';
import { ReconciliationEngineV0 } from '@co/reconciliation';
import type { Project, WorkItem } from '@co/domain';
import type { EvidenceRecord, VerificationRecord } from '@co/evidence';

const project: Project = {
  id: 'project-1', slug: 'project-1', name: 'Project 1', lifecycleState: 'ACTIVE', revision: 1,
  createdAt: new Date('2026-08-20T10:00:00Z'), updatedAt: new Date('2026-08-20T10:00:00Z'),
};
const workItem: WorkItem = {
  id: 'work-1', projectId: project.id, parentId: null, type: 'TASK', objective: 'Do work',
  lifecycleState: 'COMPLETED', revision: 5, currentAttemptId: null,
  createdAt: project.createdAt, updatedAt: project.updatedAt,
};
const evidence: EvidenceRecord = {
  id: 'evidence-1', projectId: project.id, workItemId: workItem.id, artifactId: null,
  claim: 'Tests passed', sourceType: 'VERIFICATION', sourceRef: 'test://1', currentness: 'CURRENT',
  observedAt: project.createdAt, createdAt: project.createdAt,
};
const verification: VerificationRecord = {
  id: 'verification-1', projectId: project.id, workItemId: workItem.id, verificationType: 'TEST',
  status: 'PASS', evidenceIds: [evidence.id], verifierRef: 'verifier://test',
  verifiedAt: project.createdAt, createdAt: project.createdAt,
};

describe('ReconciliationEngineV0', () => {
  it('returns PASS for consistent completed work with current evidence and PASS verification', () => {
    const result = new ReconciliationEngineV0().reconcile({ project, workItem, evidence: [evidence], verifications: [verification] });
    expect(result.state).toBe('PASS');
    expect(result.conflictCodes).toEqual([]);
    expect(result.evaluatedProjectRevision).toBe(project.revision);
    expect(result.evaluatedWorkItemRevision).toBe(workItem.revision);
  });

  it('fails when a PASS verification references missing evidence', () => {
    const result = new ReconciliationEngineV0().reconcile({ project, workItem, evidence: [], verifications: [verification] });
    expect(result.state).toBe('FAILED');
    expect(result.conflictCodes).toContain('VERIFICATION_REFERENCES_MISSING_EVIDENCE');
  });

  it('blocks when the work item is not completed', () => {
    const result = new ReconciliationEngineV0().reconcile({
      project,
      workItem: { ...workItem, lifecycleState: 'VERIFICATION_REQUIRED' },
      evidence: [evidence],
      verifications: [verification],
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.conflictCodes).toContain('WORK_ITEM_NOT_COMPLETED');
  });
});
