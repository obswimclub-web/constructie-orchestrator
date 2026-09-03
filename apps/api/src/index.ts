import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type {
  ProjectDto,
  WorkItemDto,
  AttemptDto,
  EvidenceRecordDto,
  ApprovalDto,
  ApprovalDecisionDto,
  CreateApprovalDto,
  ApprovalConsumeDto,
  ApprovalStatus,
  ApprovalEvidenceRef,
  ApprovalPostActionVerification,
  ApprovalScope,
} from '@co/contracts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app: express.Express = express();
app.use(cors());
app.use(express.json());

// ─── Projects ─────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await prisma.project.findMany();
    const dtos: ProjectDto[] = projects.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
    res.json(dtos);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Work Items ───────────────────────────────────────────────────────────────

app.get('/api/work-items', async (req, res) => {
  try {
    const items = await prisma.workItem.findMany();
    const dtos: WorkItemDto[] = items.map(i => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    }));
    res.json(dtos);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Attempts ─────────────────────────────────────────────────────────────────

app.get('/api/attempts', async (req, res) => {
  try {
    const attempts = await prisma.attempt.findMany();
    const dtos: AttemptDto[] = attempts.map(a => ({
      ...a,
      startedAt: a.startedAt?.toISOString() || null,
      endedAt: a.endedAt?.toISOString() || null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));
    res.json(dtos);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Evidence ─────────────────────────────────────────────────────────────────

app.get('/api/evidence', async (req, res) => {
  try {
    const evidence = await prisma.evidenceRecord.findMany();
    const dtos: EvidenceRecordDto[] = evidence.map(e => ({
      ...e,
      observedAt: e.observedAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
    }));
    res.json(dtos);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});


// ─── Approval Validation & Canonical Comparison ───────────────────────────────

function validateApprovalGateScope(gateKind: string, scope: unknown): string | null {
  if (!scope || typeof scope !== 'object') return 'Scope must be an object';
  
  const s = scope as Record<string, unknown>;
  if (gateKind === 'COMMIT') {
    if (s.kind !== 'COMMIT') return 'gateKind COMMIT requires scope.kind = COMMIT';
    if (!Array.isArray(s.paths)) return 'gateKind COMMIT requires scope.paths array';
    if (typeof s.message !== 'string') return 'gateKind COMMIT requires scope.message string';
  } else if (gateKind === 'PUSH') {
    if (s.kind !== 'PUSH') return 'gateKind PUSH requires scope.kind = PUSH';
    if (typeof s.commitSha !== 'string') return 'gateKind PUSH requires scope.commitSha string';
    if (typeof s.remote !== 'string') return 'gateKind PUSH requires scope.remote string';
    if (typeof s.branch !== 'string') return 'gateKind PUSH requires scope.branch string';
  }
  
  return null;
}

function canonicalizeScope(scope: unknown): unknown {
  if (scope === null || typeof scope !== 'object') return scope;
  if (Array.isArray(scope)) {
    return scope.map(canonicalizeScope);
  }
  const s = scope as Record<string, unknown>;
  const keys = Object.keys(s).sort();
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    if (s[k] !== undefined) {
      if (s.kind === 'COMMIT' && k === 'paths' && Array.isArray(s.paths)) {
        // Special sorting for COMMIT paths
        result[k] = [...new Set(s.paths as string[])].sort();
      } else {
        result[k] = canonicalizeScope(s[k]);
      }
    }
  }
  return result;
}

function isScopeEqual(persisted: unknown, requested: unknown): boolean {
  return JSON.stringify(canonicalizeScope(persisted)) === JSON.stringify(canonicalizeScope(requested));
}

// ─── Approval Authority ───────────────────────────────────────────────────────

export async function tryExpireApproval(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], approval: import("@prisma/client").Approval) {
  if (approval.status === 'USED' || approval.status === 'REJECTED' || approval.status === 'EXPIRED') {
    return { outcome: 'NOT_APPLICABLE', approval };
  }
  const updateResult = await tx.approval.updateMany({
    where: { id: approval.id, status: approval.status },
    data: { status: 'EXPIRED' }
  });
  if (updateResult.count === 0) {
    const reRead = await tx.approval.findUnique({ where: { id: approval.id } });
    if (!reRead) return { outcome: 'NOT_FOUND', approval: null };
    if (reRead.status === 'EXPIRED') return { outcome: 'EXPIRED', approval: reRead };
    return { outcome: 'CONCURRENCY_CONFLICT', approval: reRead };
  }
  const updated = await tx.approval.findUnique({ where: { id: approval.id } });
  await tx.approvalAuditEvent.create({
    data: {
      id: randomUUID(),
      approvalId: approval.id,
      eventType: 'EXPIRED',
      actorId: 'SYSTEM',
      payload: { expiresAt: approval.expiresAt ? approval.expiresAt.toISOString() : null } as object,
    }
  });
  return { outcome: 'EXPIRED', approval: updated! };
}


function mapApprovalToDto(a: {
  id: string;
  projectId: string;
  workItemId: string | null;
  attemptId: string | null;
  gateKind: string;
  status: string;
  scope: unknown;
  evidenceRefs: unknown;
  requestedBy: string;
  requestedAt: Date;
  expiresAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  rationale: string | null;
  consumedAt: Date | null;
  postActionVerification: unknown;
}): ApprovalDto {
  return {
    id: a.id,
    projectId: a.projectId,
    workItemId: a.workItemId,
    attemptId: a.attemptId,
    gateKind: a.gateKind as ApprovalDto['gateKind'],
    status: a.status as ApprovalStatus,
    scope: a.scope as ApprovalScope,
    evidenceRefs: (a.evidenceRefs as ApprovalEvidenceRef[]) || [],
    requestedBy: a.requestedBy,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() || null,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() || null,
    rationale: a.rationale,
    consumedAt: a.consumedAt?.toISOString() || null,
    postActionVerification: (a.postActionVerification as ApprovalPostActionVerification | null) || null,
  };
}

// List pending approvals
app.get('/api/approvals', async (req, res) => {
  try {
    const status = (req.query.status as string) || 'PENDING';
    const approvals = await prisma.approval.findMany({
      where: { status },
      orderBy: { requestedAt: 'desc' },
    });
    res.json(approvals.map(mapApprovalToDto));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single approval
app.get('/api/approvals/:id', async (req, res) => {
  try {
    const approval = await prisma.approval.findUnique({ where: { id: req.params.id } });
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    res.json(mapApprovalToDto(approval));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create a new approval request
app.post('/api/approvals', async (req, res) => {
  try {
    const body = req.body as CreateApprovalDto;
    if (!body.projectId || !body.gateKind || !body.scope) {
      return res.status(400).json({ error: 'projectId, gateKind, and scope are required' });
    }
    const validationError = validateApprovalGateScope(body.gateKind, body.scope);
    if (validationError) {
      return res.status(400).json({ error: validationError, code: 'INVALID_GATE_SCOPE_COMBINATION' });
    }
    
    const approvalId = randomUUID();
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.create({
        data: {
          id: approvalId,
          projectId: body.projectId,
          workItemId: body.workItemId || null,
          attemptId: body.attemptId || null,
          gateKind: body.gateKind,
          status: 'PENDING',
          scope: body.scope as object,
          evidenceRefs: (body.evidenceRefs || []) as object,
          requestedBy: body.requestedBy || 'SYSTEM',
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });

      await tx.approvalAuditEvent.create({
        data: {
          id: randomUUID(),
          approvalId,
          eventType: 'REQUESTED',
          actorId: body.requestedBy || 'SYSTEM',
          payload: {
            gateKind: body.gateKind,
            scope: body.scope as object,
            expiresAt: body.expiresAt || null,
          } as object,
        }
      });
      return approval;
    });
    
    res.status(201).json(mapApprovalToDto(result));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Decide on an approval (approve or reject) — must be PENDING
app.post('/api/approvals/:id/decide', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as ApprovalDecisionDto;
    if (!body.decision || !['APPROVED', 'REJECTED'].includes(body.decision)) {
      return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findUnique({ where: { id } });
      if (!approval) return { outcome: 'NOT_FOUND', approval: null };

      const decisionTime = new Date();
      if (approval.status === 'USED' || approval.status === 'REJECTED' || approval.status === 'APPROVED') {
        return { outcome: 'NOT_PENDING', approval };
      }

      if (approval.expiresAt && decisionTime >= approval.expiresAt) {
        if (approval.status !== 'EXPIRED') {
          return await tryExpireApproval(tx, approval);
        }
        return { outcome: 'EXPIRED', approval };
      }

      if (approval.status === 'EXPIRED') return { outcome: 'EXPIRED', approval };
      if (approval.status !== 'PENDING') return { outcome: 'NOT_PENDING', approval };

      const decidedBy = body.decidedBy || 'OWNER';
      const updateResult = await tx.approval.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: body.decision,
          decidedBy,
          decidedAt: decisionTime,
          rationale: body.rationale || null,
        }
      });
      
      if (updateResult.count === 0) return { outcome: 'CONCURRENCY_CONFLICT', approval: null };
      
      const updated = await tx.approval.findUnique({ where: { id } });
      await tx.approvalAuditEvent.create({
        data: {
          id: randomUUID(),
          approvalId: id,
          eventType: body.decision,
          actorId: decidedBy,
          payload: {
            decision: body.decision,
            rationale: body.rationale || null,
          } as object,
        }
      });
      
      return { outcome: 'DECIDED', approval: updated };
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Approval not found' });
    if (result.outcome === 'NOT_PENDING') return res.status(409).json({ error: `Approval is not pending (current status: ${result.approval?.status})`, code: 'APPROVAL_NOT_PENDING' });
    if (result.outcome === 'EXPIRED') return res.status(409).json({ error: 'Approval has expired', code: 'APPROVAL_EXPIRED' });
    if (result.outcome === 'CONCURRENCY_CONFLICT') return res.status(409).json({ error: 'Concurrent decide conflict', code: 'APPROVAL_NOT_PENDING' });

    res.json(mapApprovalToDto(result.approval!));
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: String(e) });
  }
});

// Atomically consume an APPROVED approval (single-use)
app.post('/api/approvals/:id/consume', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as ApprovalConsumeDto;
    
    // Everything inside a single transaction
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findUnique({ where: { id } });
      if (!approval) return { outcome: 'NOT_FOUND', approval: null };

      const decisionTime = new Date();
      
      // If it's already in a terminal state, don't let expiry check overwrite it
      if (approval.status === 'USED' || approval.status === 'REJECTED') {
        return { outcome: 'NOT_APPROVED', approval };
      }

      // Handle Expiry for PENDING or APPROVED
      if (approval.expiresAt && decisionTime >= approval.expiresAt) {
        if (approval.status !== 'EXPIRED') {
          // Use conditional update (CAS)
          const updateResult = await tx.approval.updateMany({
            where: { id, status: approval.status },
            data: { status: 'EXPIRED' }
          });
          
          if (updateResult.count === 0) {
            // It could have been consumed concurrently or already expired/rejected
            const reRead = await tx.approval.findUnique({ where: { id } });
            if (!reRead) return { outcome: 'NOT_FOUND', approval: null };
            if (reRead.status === 'EXPIRED') return { outcome: 'EXPIRED', approval: reRead };
            if (reRead.status !== 'APPROVED') return { outcome: 'NOT_APPROVED', approval: reRead };
            return { outcome: 'CONCURRENCY_CONFLICT', approval: reRead };
          }
          
          const updated = await tx.approval.findUnique({ where: { id } });
          await tx.approvalAuditEvent.create({
            data: {
              id: randomUUID(),
              approvalId: id,
              eventType: 'EXPIRED',
              actorId: 'SYSTEM',
              payload: { expiresAt: approval.expiresAt.toISOString() } as object,
            }
          });
          return { outcome: 'EXPIRED', approval: updated! };
        }
        return { outcome: 'EXPIRED', approval };
      }
      
      if (approval.status === 'EXPIRED') return { outcome: 'EXPIRED', approval };
      if (approval.status !== 'APPROVED') return { outcome: 'NOT_APPROVED', approval };
      
      if (approval.gateKind !== body.gateKind) return { outcome: 'GATE_KIND_MISMATCH', approval };
      if (!isScopeEqual(approval.scope, body.scope)) return { outcome: 'SCOPE_MISMATCH', approval };
      
      // Atomic condition
      const updateResult = await tx.approval.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'USED', consumedAt: decisionTime }
      });
      
      if (updateResult.count === 0) {
        // Fallback re-check for edge cases, though concurrency handled above
        return { outcome: 'CONCURRENCY_CONFLICT', approval: null };
      }
      
      const updatedApproval = await tx.approval.findUnique({ where: { id } });
      
      await tx.approvalAuditEvent.create({
        data: {
          id: randomUUID(),
          approvalId: id,
          eventType: 'USED',
          actorId: body.executorRef || 'EXECUTOR',
          payload: { 
            consumedAt: updatedApproval!.consumedAt!.toISOString(),
            gateKind: body.gateKind,
            scope: body.scope as object
          } as object,
        },
      });
      
      return { outcome: 'USED', approval: updatedApproval };
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Approval not found' });
    if (result.outcome === 'EXPIRED') return res.status(409).json({ error: 'Approval has expired', code: 'APPROVAL_EXPIRED' });
    if (result.outcome === 'NOT_APPROVED') return res.status(409).json({ error: 'Approval cannot be consumed', code: 'APPROVAL_NOT_APPROVED' });
    if (result.outcome === 'GATE_KIND_MISMATCH') return res.status(400).json({ error: 'Approval gate kind mismatch', code: 'APPROVAL_GATE_KIND_MISMATCH' });
    if (result.outcome === 'SCOPE_MISMATCH') return res.status(400).json({ error: 'Approval scope mismatch', code: 'APPROVAL_SCOPE_MISMATCH' });
    if (result.outcome === 'CONCURRENCY_CONFLICT') return res.status(409).json({ error: 'Concurrent consume conflict', code: 'APPROVAL_NOT_APPROVED' });

    res.json(mapApprovalToDto(result.approval!));
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: String(e) });
  }
});

// Attach post-action verification to a consumed approval
app.post('/api/approvals/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const approval = await prisma.approval.findUnique({ where: { id } });
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    if (approval.status !== 'USED') {
      return res.status(409).json({ error: 'Post-action verification only allowed on USED approvals' });
    }
    const verification = req.body as ApprovalPostActionVerification;
    const updated = await prisma.approval.update({
      where: { id },
      data: { postActionVerification: verification as object },
    });
    await prisma.approvalAuditEvent.create({
      data: {
        id: randomUUID(),
        approvalId: id,
        eventType: 'POST_ACTION_VERIFIED',
        actorId: 'VERIFIER',
        payload: verification as object,
      },
    });
    res.json(mapApprovalToDto(updated));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────

app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
    const cursor = req.query.cursor as string | undefined;
    const attemptId = req.query.attemptId as string | undefined;

    const whereClause: import('@prisma/client').Prisma.ProjectEventWhereInput = {
      eventType: {
        in: [
          'HOST_ACTION_PROPOSED',
          'HOST_ACTION_POLICY_DECIDED',
          'HOST_ACTION_EXECUTION_COMPLETED',
          'HOST_ACTION_RECONCILIATION_REQUIRED'
        ]
      }
    };
    if (attemptId) {
      whereClause.aggregateId = attemptId;
      whereClause.aggregateType = 'ATTEMPT';
    }

    const events = await prisma.projectEvent.findMany({
      where: whereClause,
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { occurredAt: 'asc' }
    });

    res.json({
      items: events.map(e => ({
        id: e.id,
        eventType: e.eventType,
        actorType: e.actorType,
        actorId: e.actorId,
        occurredAt: e.occurredAt.toISOString(),
        payload: e.payload
      })),
      nextCursor: events.length > 0 && events.length === limit ? events[events.length - 1]!.id : null
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

export { app };
