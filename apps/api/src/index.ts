import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { 
  ProjectDto, 
  WorkItemDto, 
  AttemptDto, 
  EvidenceRecordDto 
} from '@co/contracts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app: express.Express = express();
app.use(cors());
app.use(express.json());

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

app.get('/api/approvals', async (req, res) => {
  try {
    // approvals: WorkItem WHERE gate_pending, or similar based on schema
    // Let's assume gate_pending translates to lifecycleState = 'GATE_PENDING' or similar, 
    // or maybe it's just 'PENDING'
    // I will query where lifecycleState is 'PENDING_APPROVAL' or just use 'GATE_PENDING'
    // wait, what lifecycle states exist in domain? Let me check domain/work-item.ts
    // For now I'll just query lifecycleState: 'PENDING_APPROVAL' or similar.
    const items = await prisma.workItem.findMany({
      where: {
        lifecycleState: {
          in: ['REVIEW_REQUIRED', 'VERIFICATION_REQUIRED']
        }
      }
    });
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
