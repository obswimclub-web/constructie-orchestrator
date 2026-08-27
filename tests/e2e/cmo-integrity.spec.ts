import { describe, expect, it } from 'vitest';
import { resolveCmosForProject, CompletionContext } from '../../packages/completion/src/cmo.js';

describe('CMO Applicability Integrity', () => {
  it('derives UNRESOLVED when material trigger facts are missing', () => {
    const cmos = resolveCmosForProject({
      project: {} as Parameters<typeof resolveCmosForProject>[0]["project"],
      workItem: {} as Parameters<typeof resolveCmosForProject>[0]["project"]
    }); 
    for (const cmo of cmos) {
      expect(cmo.status).toBe('UNRESOLVED');
      expect(cmo.provenance).toContain('Missing');
    }
  });

  it('derives REQUIRED, N_A and DONE appropriately based on evidence', () => {
    const ctx: CompletionContext = {
      project: { id: 'p1', name: 'Test', slug: 'test', lifecycleState: 'ACTIVE', revision: 1, createdAt: new Date(), updatedAt: new Date() },
      workItem: { id: 'w1', projectId: 'p1', lifecycleState: 'COMPLETED', objective: 'Test', authorRef: 'test', revision: 1, createdAt: new Date(), updatedAt: new Date() }
    };
    const cmos = resolveCmosForProject(ctx);
    const cmo1 = cmos.find(c => c.cmoId === 'CMO-01');
    expect(cmo1?.status).toBe('REQUIRED');

    const cmo2 = cmos.find(c => c.cmoId === 'CMO-02');
    expect(cmo2?.status).toBe('REQUIRED');

    const cmo3 = cmos.find(c => c.cmoId === 'CMO-03');
    expect(cmo3?.status).toBe('N_A');
  });
});
