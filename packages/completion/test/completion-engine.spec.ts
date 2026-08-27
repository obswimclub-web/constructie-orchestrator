import { describe, expect, it } from 'vitest';
import type { Project, WorkItem } from '@co/domain';
import type { EvidenceRecord, VerificationRecord } from '@co/evidence';
import { CompletionEngineV0, type CompletionDecision, type CompletionStore } from '../src/index.js';

class InMemoryCompletionStore implements CompletionStore {
  decisions: CompletionDecision[] = [];
  async saveDecision(decision: CompletionDecision) {
    this.decisions.push(decision);
    return decision;
  }
}

const project: Project = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'p1', name: 'P1', lifecycleState: 'ACTIVE', revision: 7,
  createdAt: new Date('2026-08-20T00:00:00Z'), updatedAt: new Date('2026-08-20T00:00:00Z'),
};
const workItem: WorkItem = {
  id: '22222222-2222-4222-8222-222222222222', projectId: project.id, parentId: null, type: 'TASK', objective: 'Do it', lifecycleState: 'COMPLETED', revision: 5, currentAttemptId: null,
  createdAt: new Date('2026-08-20T00:00:00Z'), updatedAt: new Date('2026-08-20T00:00:00Z'),
};
const evidence: EvidenceRecord = {
  id: '33333333-3333-4333-8333-333333333333', projectId: project.id, workItemId: workItem.id, artifactId: null,
  claim: 'Tests pass', sourceType: 'VERIFICATION', sourceRef: 'test-run-1', currentness: 'CURRENT', observedAt: new Date(), createdAt: new Date(),
};

const evidenceCMO1 = { ...evidence, id: 'cmo-1', claim: 'CMO-01' };
const evidenceCMO2 = { ...evidence, id: 'cmo-2', claim: 'CMO-02' };
const evidenceCMO5 = { ...evidence, id: 'cmo-5', claim: 'CMO-05' };
const evidenceCMO14 = { ...evidence, id: 'cmo-14', claim: 'CMO-14' };
const allEvidence = [evidence, evidenceCMO1, evidenceCMO2, evidenceCMO5, evidenceCMO14];

const verification: VerificationRecord = {
  id: '44444444-4444-4444-8444-444444444444', projectId: project.id, workItemId: workItem.id, verificationType: 'TEST', status: 'PASS', evidenceIds: [evidence.id], verifierRef: 'verifier-1', verifiedAt: new Date(), createdAt: new Date(),
};
const reconciliation = { state: 'PASS' as const, projectId: project.id, evaluatedProjectRevision: 7, evaluatedWorkItemId: workItem.id, evaluatedWorkItemRevision: 5, evaluatedAt: new Date(), ref: 'recon-1' };

describe('CompletionEngineV0', () => {
  it('issues COMPLETE only with exact revisions, current evidence, PASS verification, and reconciliation PASS', async () => {
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [verification], evidence: allEvidence, reconciliation });
    expect(result.state).toBe('COMPLETE');
    expect(result.evaluatedProjectRevision).toBe(7);
    expect(result.evaluatedWorkItemRevision).toBe(5);
  });

  it('refuses completion when reconciliation snapshot is stale', async () => {
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [verification], evidence: allEvidence, reconciliation: { ...reconciliation, evaluatedProjectRevision: 6 } });
    expect(result.state).toBe('RECONCILIATION_FAILED');
  });

  it('refuses completion when evidence is stale', async () => {
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [verification], evidence: [{ ...evidence, currentness: 'STALE' }], reconciliation });
    expect(result.state).toBe('EVIDENCE_INSUFFICIENT');
  });

  it('does not treat work-item completion alone as outcome completion', async () => {
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [], evidence: [], reconciliation });
    expect(result.state).toBe('EVIDENCE_INSUFFICIENT');
  });
});

  it('reports residual scope and refuses COMPLETE if a verification failed', async () => {
    const failedVerification: VerificationRecord = {
      id: '55555555-5555-4555-8555-555555555555', projectId: project.id, workItemId: workItem.id, verificationType: 'SECURITY', status: 'FAIL', evidenceIds: [evidence.id], verifierRef: 'verifier-2', verifiedAt: new Date(), createdAt: new Date(),
    };
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [verification, failedVerification], evidence: allEvidence, reconciliation });
    expect(result.state).toBe('INCOMPLETE');
    expect(result.residualScope.length).toBeGreaterThan(0);
    expect(result.residualScope.some(x => x.type === 'FAILED_VERIFICATION')).toBe(true);
  });

  it('reports residual scope if reconciliation is BLOCKED', async () => {
    const blockedRecon = { ...reconciliation, state: 'BLOCKED' as const, conflictCodes: ['UNRESOLVED_GIT_CONFLICT'] };
    const result = await new CompletionEngineV0(new InMemoryCompletionStore()).evaluate({ project, workItem, completionObjectRef: 'outcome-1', verifications: [verification], evidence: allEvidence, reconciliation: blockedRecon });
    expect(result.state).toBe('BLOCKED');
    expect(result.residualScope.length).toBeGreaterThan(0);
    expect(result.residualScope.some(x => x.type === 'UNRESOLVED_FINDING')).toBe(true);
    expect(result.residualScope[0]?.description).toContain('UNRESOLVED_GIT_CONFLICT');
  });
