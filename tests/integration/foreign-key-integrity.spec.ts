import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('F-015 Physical Foreign Key Integrity', () => {
  // Shared test entities
  const projectId = randomUUID();
  const workItemId = randomUUID();
  const attemptId = randomUUID();
  const approvalId = randomUUID();
  const artifactId = randomUUID();

  beforeAll(async () => {
    // Create prerequisite parent entities
    await prisma.project.create({ data: { id: projectId, slug: `fk-test-${Date.now()}`, name: 'FK Test' } });
    await prisma.workItem.create({ data: { id: workItemId, projectId, type: 'TASK', objective: 'FK Test' } });
    await prisma.attempt.create({ data: { id: attemptId, projectId, workItemId, attemptNumber: 1, workPackageVersion: 1 } });
    await prisma.approval.create({ data: { id: approvalId, projectId, workItemId, attemptId, gateKind: 'TEST_GATE', status: 'PENDING', scope: {}, evidenceRefs: [] } });
    await prisma.artifactRecord.create({ data: { id: artifactId, projectId, runId: 'fk-test-run', workItemId, attemptId, kind: 'FILE', uri: 'test://fk', producedBy: 'test' } });
  });

  afterAll(async () => {
    await prisma.incidentEventRecord.deleteMany({ where: { projectId } });
    await prisma.executionLogRecord.deleteMany({ where: { projectId } });
    await prisma.verificationRecord.deleteMany({ where: { projectId } });
    await prisma.evidenceRecord.deleteMany({ where: { projectId } });
    await prisma.artifactRecord.deleteMany({ where: { projectId } });
    await prisma.completionDecision.deleteMany({ where: { projectId } });
    await prisma.approval.deleteMany({ where: { projectId } });
    await prisma.attempt.deleteMany({ where: { projectId } });
    await prisma.workItem.deleteMany({ where: { projectId } });
    await prisma.outboxEvent.deleteMany({ where: { projectId } });
    await prisma.projectEvent.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ── Constraint catalog ──────────────────────────────────────────────

  const expectedConstraints = [
    // outbox
    { table: 'outbox_events', name: 'outbox_events_project_id_fkey' },
    // work_items
    { table: 'work_items', name: 'work_items_parent_id_fkey' },
    // artifact_records
    { table: 'artifact_records', name: 'artifact_records_project_id_fkey' },
    { table: 'artifact_records', name: 'artifact_records_work_item_id_fkey' },
    { table: 'artifact_records', name: 'artifact_records_attempt_id_fkey' },
    // evidence_records
    { table: 'evidence_records', name: 'evidence_records_project_id_fkey' },
    { table: 'evidence_records', name: 'evidence_records_work_item_id_fkey' },
    { table: 'evidence_records', name: 'evidence_records_attempt_id_fkey' },
    { table: 'evidence_records', name: 'evidence_records_artifact_id_fkey' },
    { table: 'evidence_records', name: 'evidence_records_approval_id_fkey' },
    // verification_records
    { table: 'verification_records', name: 'verification_records_project_id_fkey' },
    { table: 'verification_records', name: 'verification_records_work_item_id_fkey' },
    { table: 'verification_records', name: 'verification_records_attempt_id_fkey' },
    { table: 'verification_records', name: 'verification_records_completion_decision_id_fkey' },
    // completion_decisions
    { table: 'completion_decisions', name: 'completion_decisions_project_id_fkey' },
    { table: 'completion_decisions', name: 'completion_decisions_evaluated_work_item_id_fkey' },
    // approvals
    { table: 'approvals', name: 'approvals_project_id_fkey' },
    { table: 'approvals', name: 'approvals_work_item_id_fkey' },
    { table: 'approvals', name: 'approvals_attempt_id_fkey' },
    // execution_log_records
    { table: 'execution_log_records', name: 'execution_log_records_project_id_fkey' },
    { table: 'execution_log_records', name: 'execution_log_records_work_item_id_fkey' },
    { table: 'execution_log_records', name: 'execution_log_records_attempt_id_fkey' },
    // incident_event_records
    { table: 'incident_event_records', name: 'incident_event_records_project_id_fkey' },
    { table: 'incident_event_records', name: 'incident_event_records_work_item_id_fkey' },
    { table: 'incident_event_records', name: 'incident_event_records_attempt_id_fkey' },
  ];

  it('all F-015 constraints exist and are validated in PostgreSQL', async () => {
    const result = await prisma.$queryRawUnsafe<{ relname: string; conname: string; convalidated: boolean }[]>(`
      SELECT con.conname, rel.relname, con.convalidated
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE con.contype = 'f';
    `);

    for (const expected of expectedConstraints) {
      const found = result.find(r => r.relname === expected.table && r.conname === expected.name);
      expect(found, `Constraint ${expected.name} on ${expected.table} not found`).toBeDefined();
      expect(found?.convalidated, `Constraint ${expected.name} is NOT VALID`).toBe(true);
    }
  });

  // ── Orphan rejection matrix ─────────────────────────────────────────

  it('rejects orphan outbox_event → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, payload, correlation_id)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'T', 'T', gen_random_uuid(), '{}', 'c');
    `)).rejects.toThrow(/outbox_events_project_id_fkey/);
  });

  it('rejects orphan artifact → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO artifact_records (id, project_id, run_id, work_item_id, kind, uri, produced_by)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'r', '${workItemId}', 'FILE', 'u', 'p');
    `)).rejects.toThrow(/artifact_records_project_id_fkey/);
  });

  it('rejects orphan artifact → workItem', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO artifact_records (id, project_id, run_id, work_item_id, kind, uri, produced_by)
      VALUES (gen_random_uuid(), '${projectId}', 'r', gen_random_uuid(), 'FILE', 'u', 'p');
    `)).rejects.toThrow(/artifact_records_work_item_id_fkey/);
  });

  it('rejects orphan artifact → attempt', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO artifact_records (id, project_id, run_id, work_item_id, attempt_id, kind, uri, produced_by)
      VALUES (gen_random_uuid(), '${projectId}', 'r', '${workItemId}', gen_random_uuid(), 'FILE', 'u', 'p');
    `)).rejects.toThrow(/artifact_records_attempt_id_fkey/);
  });

  it('rejects orphan evidence → approval', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO evidence_records (id, project_id, run_id, work_item_id, approval_id, claim, source_type, source_ref, observed_at)
      VALUES (gen_random_uuid(), '${projectId}', 'r', '${workItemId}', gen_random_uuid(), 'c', 's', 'r', now());
    `)).rejects.toThrow(/evidence_records_approval_id_fkey/);
  });

  it('rejects orphan evidence → artifact', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO evidence_records (id, project_id, run_id, work_item_id, artifact_id, claim, source_type, source_ref, observed_at)
      VALUES (gen_random_uuid(), '${projectId}', 'r', '${workItemId}', gen_random_uuid(), 'c', 's', 'r', now());
    `)).rejects.toThrow(/evidence_records_artifact_id_fkey/);
  });

  it('rejects orphan verification → completionDecision', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO verification_records (id, project_id, run_id, work_item_id, verification_type, status, evidence_ids, verifier_ref, completion_decision_id, verified_at)
      VALUES (gen_random_uuid(), '${projectId}', 'r', '${workItemId}', 'TEST', 'PASS', '[]', 'v', gen_random_uuid(), now());
    `)).rejects.toThrow(/verification_records_completion_decision_id_fkey/);
  });

  it('rejects orphan completionDecision → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO completion_decisions (id, project_id, completion_object_ref, state, evaluated_project_revision, evaluated_work_item_id, evaluated_work_item_revision, verification_ids, evidence_ids, reconciliation_ref, rationale_codes, decided_at)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'ref', 'APPROVED', 1, '${workItemId}', 1, '[]', '[]', 'r', '[]', now());
    `)).rejects.toThrow(/completion_decisions_project_id_fkey/);
  });

  it('rejects orphan approval → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO approvals (id, project_id, gate_kind, status, scope, evidence_refs)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'TEST', 'PENDING', '{}', '[]');
    `)).rejects.toThrow(/approvals_project_id_fkey/);
  });

  it('rejects orphan workItem.parent → workItem', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO work_items (id, project_id, parent_id, type, objective)
      VALUES (gen_random_uuid(), '${projectId}', gen_random_uuid(), 'TASK', 'orphan child');
    `)).rejects.toThrow(/work_items_parent_id_fkey/);
  });

  it('rejects orphan executionLog → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO execution_log_records (id, project_id, run_id, stream, message, sequence, timestamp, hash)
      VALUES ('log-fk-' || gen_random_uuid()::text, gen_random_uuid(), 'r', 's', 'm', 1, now(), 'h');
    `)).rejects.toThrow(/execution_log_records_project_id_fkey/);
  });

  it('rejects orphan incident → project', async () => {
    await expect(prisma.$queryRawUnsafe(`
      INSERT INTO incident_event_records (id, incident_id, project_id, run_id, state, severity, description, timestamp, hash, sequence)
      VALUES ('inc-fk-' || gen_random_uuid()::text, 'i1', gen_random_uuid(), 'r', 'OPEN', 'HIGH', 'd', now(), 'h', 1);
    `)).rejects.toThrow(/incident_event_records_project_id_fkey/);
  });

  // ── RESTRICT behavior proof ─────────────────────────────────────────

  it('RESTRICT: cannot delete project with artifact_records children', async () => {
    // artifactRecord already exists for projectId from beforeAll
    await expect(
      prisma.project.delete({ where: { id: projectId } })
    ).rejects.toThrow(/foreign key constraint/i);
  });

  // ── SET NULL behavior proof ─────────────────────────────────────────

  it('SET NULL: deleting attempt nullifies artifact.attemptId', async () => {
    const tempAttemptId = randomUUID();
    const tempArtifactId = randomUUID();
    await prisma.attempt.create({ data: { id: tempAttemptId, projectId, workItemId, attemptNumber: 99, workPackageVersion: 1, active: false } });
    await prisma.artifactRecord.create({ data: { id: tempArtifactId, projectId, runId: 'sn-test', workItemId, attemptId: tempAttemptId, kind: 'FILE', uri: 'test://sn', producedBy: 'test' } });

    await prisma.attempt.delete({ where: { id: tempAttemptId } });

    const art = await prisma.artifactRecord.findUnique({ where: { id: tempArtifactId } });
    expect(art?.attemptId).toBeNull();

    // cleanup
    await prisma.artifactRecord.delete({ where: { id: tempArtifactId } });
  });

  // ── CASCADE behavior proof (pre-existing, not F-015) ────────────────

  it('CASCADE: deleting project cascades to outbox_events', async () => {
    const tempProjId = randomUUID();
    await prisma.project.create({ data: { id: tempProjId, slug: `cascade-test-${Date.now()}`, name: 'Cascade Test' } });
    await prisma.outboxEvent.create({ data: { id: randomUUID(), projectId: tempProjId, eventType: 'T', aggregateType: 'T', aggregateId: randomUUID(), payload: {}, correlationId: 'c' } });

    await prisma.project.delete({ where: { id: tempProjId } });

    const remaining = await prisma.outboxEvent.findMany({ where: { projectId: tempProjId } });
    expect(remaining).toHaveLength(0);
  });
});
