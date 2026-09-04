import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../apps/api/src/index';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHmac } from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SECRET = 'test-secret';
process.env.API_SERVICE_TOKEN = SECRET;

function generateToken(projectId: string) {
  const hmac = createHmac('sha256', SECRET);
  hmac.update(projectId);
  return `${projectId}.${hmac.digest('hex')}`;
}

describe('API-001 Read-Only Telemetry Endpoints', () => {
  let projA: string;
  let projB: string;
  let approvalA: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    await prisma.approvalAuditEvent.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.workItem.deleteMany();
    await prisma.project.deleteMany();

    projA = randomUUID();
    projB = randomUUID();
    tokenA = generateToken(projA);
    tokenB = generateToken(projB);

    await prisma.project.create({
      data: { id: projA, slug: 'test-project-a', name: 'Test Project A', lifecycleState: 'ACTIVE', revision: 1 }
    });
    await prisma.project.create({
      data: { id: projB, slug: 'test-project-b', name: 'Test Project B', lifecycleState: 'ACTIVE', revision: 1 }
    });

    const wiA = await prisma.workItem.create({
      data: { id: randomUUID(), projectId: projA, type: 'FEATURE', objective: 'Obj A', lifecycleState: 'REVIEW_REQUIRED', revision: 1 }
    });
    
    await prisma.workItem.create({
      data: { id: randomUUID(), projectId: projB, type: 'FEATURE', objective: 'Obj B', lifecycleState: 'RUNNING', revision: 1 }
    });

    const appA = await prisma.approval.create({
      data: {
        id: randomUUID(),
        projectId: projA,
        workItemId: wiA.id,
        gateKind: 'COMMIT',
        scope: { kind: 'COMMIT', paths: ['apps/api/src/index.ts'] },
        evidenceRefs: [],
        requestedBy: 'SYSTEM',
        status: 'PENDING',
      }
    });
    approvalA = appA.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('HEALTH_PUBLIC_AS_INTENDED', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('AUTH_MISSING', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });

  it('AUTH_INVALID', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', 'Bearer invalid');
    expect(res.status).toBe(401);
  });

  it('AUTH_VALID', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });

  it('PROJECT_A_LISTS_ONLY_A', async () => {
    const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(projA);
  });

  it('PROJECT_A_CANNOT_READ_B', async () => {
    const res = await request(app).get('/api/work-items').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].projectId).toBe(projA);
  });

  it('APPROVAL_DECIDE_PROJECT_BOUND - tokenB cannot mutate approvalA', async () => {
    const res = await request(app).post(`/api/approvals/${approvalA}/decide`).set('Authorization', `Bearer ${tokenB}`).send({ decision: 'APPROVED' });
    // It should say not found because it's filtered by projectId: B
    console.log(res.body); expect(res.status).toBe(404);
  });
  
  it('APPROVAL_DECIDE_PROJECT_BOUND - tokenA can mutate approvalA', async () => {
    const res = await request(app).post(`/api/approvals/${approvalA}/decide`).set('Authorization', `Bearer ${tokenA}`).send({ decision: 'APPROVED', executorRef: 'TEST' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('APPROVAL_CONSUME_PROJECT_BOUND - tokenB cannot consume approvalA', async () => {
    const res = await request(app).post(`/api/approvals/${approvalA}/consume`).set('Authorization', `Bearer ${tokenB}`).send({ gateKind: 'COMMIT', scope: { kind: 'COMMIT', paths: ['apps/api/src/index.ts'] } });
    console.log(res.body); expect(res.status).toBe(404);
  });
});
