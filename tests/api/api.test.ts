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
    await prisma.workItem.deleteMany();
    await prisma.project.deleteMany();

    // Create a mock project
    const proj = await prisma.project.create({
      data: {
        id: randomUUID(),
        slug: 'test-project',
        name: 'Test Project',
        lifecycleState: 'ACTIVE',
        revision: 1
      }
    });

    // Create mock work items
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

    await prisma.workItem.create({
      data: {
        id: randomUUID(),
        projectId: proj.id,
        type: 'FEATURE',
        objective: 'Test Objective 2 (Approval Needed)',
        lifecycleState: 'REVIEW_REQUIRED',
        revision: 1
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

  it('GET /api/approvals should return only items in REVIEW_REQUIRED', async () => {
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
    expect(res.body[0].objective).toContain('Approval Needed');
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
