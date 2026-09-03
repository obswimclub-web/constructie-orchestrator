import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../apps/api/src/index';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('API-001 Read-Only Telemetry Endpoints', () => {
  beforeAll(async () => {
    // Clean up
    await prisma.approvalAuditEvent.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.workItem.deleteMany();
    await prisma.project.deleteMany();

    const proj = await prisma.project.create({
      data: {
        id: randomUUID(),
        slug: 'test-project',
        name: 'Test Project',
        lifecycleState: 'ACTIVE',
        revision: 1
      }
    });

    await prisma.workItem.create({
      data: {
        id: randomUUID(),
        projectId: proj.id,
        type: 'FEATURE',
        objective: 'Test Objective 1',
        lifecycleState: 'RUNNING',
        revision: 1
      }
    });

    const wi2 = await prisma.workItem.create({
      data: {
        id: randomUUID(),
        projectId: proj.id,
        type: 'FEATURE',
        objective: 'Test Objective 2 (Approval Needed)',
        lifecycleState: 'REVIEW_REQUIRED',
        revision: 1
      }
    });

    await prisma.approval.create({
      data: {
        id: randomUUID(),
        projectId: proj.id,
        workItemId: wi2.id,
        gateKind: 'COMMIT',
        scope: { kind: 'COMMIT', paths: ['apps/api/src/index.ts'], message: 'feat: test' },
        evidenceRefs: [{ id: randomUUID(), claim: 'Tests pass', sourceRef: 'ci/123' }],
        requestedBy: 'SYSTEM',
        status: 'PENDING',
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /api/projects should return projects', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBe('Test Project');
  });

  it('GET /api/work-items should return work items', async () => {
    const res = await request(app).get('/api/work-items');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(2);
  });

  it('GET /api/approvals returns real Approval records with canonical fields', async () => {
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
    const approval = res.body[0];
    expect(approval.gateKind).toBe('COMMIT');
    expect(approval.status).toBe('PENDING');
    expect(approval.scope).toHaveProperty('kind', 'COMMIT');
    expect(approval.evidenceRefs).toHaveLength(1);
    expect(approval.requestedBy).toBe('SYSTEM');
    // No fabricated fields
    expect(approval).not.toHaveProperty('qualificationStatus');
    expect(approval).not.toHaveProperty('reviewerStatus');
  });

  it('GET /api/attempts should return attempts', async () => {
    const res = await request(app).get('/api/attempts');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });

  it('GET /api/evidence should return evidence', async () => {
    const res = await request(app).get('/api/evidence');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });
});
