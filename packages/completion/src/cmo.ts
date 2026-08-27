import type { Project, WorkItem } from '@co/domain';

export interface CompletionContext {
  project: Project;
  workItem: WorkItem;
}

export type CmoStatus = 'REQUIRED' | 'N_A' | 'UNRESOLVED' | 'DONE';

export interface CmoResolution {
  cmoId: string;
  status: CmoStatus;
  provenance: string;
}

export interface CmoRule {
  id: string;
  description: string;
  evaluate: (ctx: CompletionContext) => CmoResolution;
}

export const KNOWN_CMO_RULES: CmoRule[] = [
  {
    id: 'CMO-01',
    description: 'executable/operational outcome required',
    evaluate: (ctx) => {
      // Very naive implementation for V1 scope
      if (!ctx.project.name || !ctx.workItem.objective) return { cmoId: 'CMO-01', status: 'UNRESOLVED', provenance: 'Missing context' };
      return { cmoId: 'CMO-01', status: 'REQUIRED', provenance: 'Project has executable outcome' };
    }
  },
  {
    id: 'CMO-02',
    description: 'test assurance/governance required',
    evaluate: (ctx) => {
      if (!ctx.project.name || !ctx.workItem.objective) return { cmoId: 'CMO-02', status: 'UNRESOLVED', provenance: 'Missing context' };
      return { cmoId: 'CMO-02', status: 'REQUIRED', provenance: 'Project requires test assurance' };
    }
  },
  {
    id: 'CMO-03',
    description: 'independent assurance/separation required',
    evaluate: (ctx) => {
      if (!ctx.project.name) return { cmoId: 'CMO-03', status: 'UNRESOLVED', provenance: 'Missing context' };
      // Let's say for V1 we don't require independent assurance
      return { cmoId: 'CMO-03', status: 'N_A', provenance: 'Affirmative exclusion: independent assurance not in V1 scope' };
    }
  },
  {
    id: 'CMO-05',
    description: 'repo artifact must reach versioned state',
    evaluate: (ctx) => {
      if (!ctx.project.name) return { cmoId: 'CMO-05', status: 'UNRESOLVED', provenance: 'Missing context' };
      return { cmoId: 'CMO-05', status: 'REQUIRED', provenance: 'Project requires versioned state' };
    }
  },
  {
    id: 'CMO-06',
    description: 'remote publication is delivery boundary',
    evaluate: (ctx) => {
      if (!ctx.project.name) return { cmoId: 'CMO-06', status: 'UNRESOLVED', provenance: 'Missing context' };
      return { cmoId: 'CMO-06', status: 'N_A', provenance: 'Affirmative exclusion: remote publication not in V1 scope' };
    }
  },
  {
    id: 'CMO-14',
    description: 'material recovery/containment capability required',
    evaluate: (ctx) => {
      if (!ctx.project.name) return { cmoId: 'CMO-14', status: 'UNRESOLVED', provenance: 'Missing context' };
      return { cmoId: 'CMO-14', status: 'REQUIRED', provenance: 'Project requires recovery capability' };
    }
  }
];

export function resolveCmosForProject(context: CompletionContext, evidenceGiven: string[] = []): CmoResolution[] {
  return KNOWN_CMO_RULES.map(rule => {
    const base = rule.evaluate(context);
    if (base.status === 'REQUIRED' && evidenceGiven.includes(base.cmoId)) {
      return { ...base, status: 'DONE', provenance: base.provenance + ' -> Satisfied by evidence' };
    }
    return base;
  });
}
