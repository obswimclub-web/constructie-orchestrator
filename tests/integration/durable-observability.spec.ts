import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaExecutionLogger, PrismaIncidentService, PrismaTraceabilityService } from '../../packages/persistence/src/index.js';
import {
  CAN_RECONSTRUCT_RUN_FROM_PERSISTED_OR_DURABLE_RECORDS,
  RunReconstructor
} from '../../packages/observability/src/index.js';

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/orchestrator',
  password: 'postgres'
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Durable Observability (P9-S3)', () => {
  beforeAll(async () => {
    await prisma.executionLogRecord.deleteMany();
    await prisma.incidentEventRecord.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.verificationRecord.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('Execution Logs: persistence survives reconstruction, keeps ordering, isolated, secret safe', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const p2 = '00000000-0000-0000-0000-000000000002';
    const attemptId = '00000000-0000-0000-0000-0000000000a1';
    const workItemId = '00000000-0000-0000-0000-0000000000b1';
    
    const redactor = {
      redact: (s: string) => s.replace('super_secret_token', '[REDACTED]')
    };

    const logger1 = new PrismaExecutionLogger(prisma, redactor, () => new Date('2026-09-05T00:00:00Z'), () => 'fixed-id-1');
    await logger1.initialize(p1, 'run-1');
    logger1.log(p1, 'run-1', 'hello super_secret_token', {
      stream: 'STDOUT',
      attemptId,
      workItemId,
      metadata: { secret: 'super_secret_token' }
    });
    await logger1.flush();
    
    // Simulate restart/reconnect with a new logger instance
    const logger2 = new PrismaExecutionLogger(prisma, redactor, () => new Date('2026-09-05T00:00:01Z'), () => 'fixed-id-2');
    await logger2.initialize(p1, 'run-1');
    logger2.log(p1, 'run-1', 'second msg', {
      stream: 'STDERR',
      attemptId,
      workItemId
    });
    await logger2.flush();

    // Verify
    const logs = await logger2.getLogsAsync(p1, { runId: 'run-1' });
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('hello [REDACTED]');
    expect(logs[0].metadata).toEqual({ secret: '[REDACTED]' });
    expect(logs[1].message).toBe('second msg');
    expect(logs[0].sequence).toBe(1);
    expect(logs[1].sequence).toBe(2);
    expect(logs[0].stream).toBe('STDOUT');
    expect(logs[1].stream).toBe('STDERR');
    expect(logs[0].attemptId).toBe(attemptId);
    expect(logs[0].workItemId).toBe(workItemId);
    expect(logs[1].previousHash).toBe(logs[0].hash);

    // Project isolation
    const logsP2 = await logger2.getLogsAsync(p2);
    expect(logsP2).toHaveLength(0);
  });

  it('Incidents: persistence survives restart, linkage correct, isolated, deterministic', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const p2 = '00000000-0000-0000-0000-000000000002';
    const attemptId = '00000000-0000-0000-0000-0000000000a1';
    const workItemId = '00000000-0000-0000-0000-0000000000b1';
    
    const incSvc = new PrismaIncidentService(prisma);
    await incSvc.initialize(p1);
    
    const inc1 = incSvc.openIncident(p1, 'run-inc', 'database connection timeout', 'HIGH', {
      attemptId,
      workItemId
    });
    await incSvc.flush();
    
    // Simulate restart/reconnect by re-initializing a new service instance from DB
    const incSvc2 = new PrismaIncidentService(prisma);
    await incSvc2.initialize(p1);
    
    incSvc2.mitigateIncident(p1, inc1.incidentId, 'reconnected with exponential backoff');
    incSvc2.resolveIncident(p1, inc1.incidentId, 'connection restored and healthy');
    await incSvc2.flush();

    const events = await incSvc2.listIncidentEventsAsync(p1);
    expect(events).toHaveLength(3);
    expect(events[0].state).toBe('OPEN');
    expect(events[1].state).toBe('MITIGATED');
    expect(events[2].state).toBe('RESOLVED');
    expect(events[0].incidentId).toBe(inc1.incidentId);
    expect(events[0].runId).toBe('run-inc');
    expect(events[0].attemptId).toBe(attemptId);
    expect(events[0].workItemId).toBe(workItemId);
    expect(events[1].previousHash).toBe(events[0].hash);
    expect(events[2].previousHash).toBe(events[1].hash);
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
    expect(events[2].sequence).toBe(3);

    // Project isolation
    const eventsP2 = await incSvc2.listIncidentEventsAsync(p2);
    expect(eventsP2).toHaveLength(0);
  });

  it('Reverse Traceability: correctly maps commit/deploy/artifact/evidence/verification to lineage', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const p2 = '00000000-0000-0000-0000-000000000002';
    const artifactId = '33333333-3333-3333-3333-333333333333';
    
    await prisma.evidenceRecord.create({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
        projectId: p1,
        runId: 'r-1',
        workItemId: '00000000-0000-0000-0000-0000000000e1',
        attemptId: '00000000-0000-0000-0000-0000000000f1',
        scmCommitSha: 'commit_sha_123',
        deploymentUri: 'https://staging.app/deploy/123',
        artifactId,
        claim: 'deployed revision to staging',
        sourceType: 'git',
        sourceRef: 'refs/heads/main',
        observedAt: new Date()
      }
    });

    await prisma.verificationRecord.create({
      data: {
        id: '22222222-2222-2222-2222-222222222222',
        projectId: p1,
        runId: 'r-1',
        workItemId: '00000000-0000-0000-0000-0000000000e1',
        attemptId: '00000000-0000-0000-0000-0000000000f1',
        verificationType: 'TEST',
        status: 'PASS',
        evidenceIds: ['11111111-1111-1111-1111-111111111111'],
        verifierRef: 'verifier:automated-suite',
        completionDecisionId: '00000000-0000-0000-0000-0000000000c1',
        verifiedAt: new Date()
      }
    });

    const tracer = new PrismaTraceabilityService(prisma);
    
    // Trace by SCM commit SHA
    const resCommit = await tracer.traceScmCommit(p1, 'commit_sha_123');
    expect(resCommit.attemptIds).toContain('00000000-0000-0000-0000-0000000000f1');
    expect(resCommit.workItemIds).toContain('00000000-0000-0000-0000-0000000000e1');
    expect(resCommit.evidenceIds).toContain('11111111-1111-1111-1111-111111111111');
    expect(resCommit.verificationIds).toContain('22222222-2222-2222-2222-222222222222');
    expect(resCommit.completionDecisionIds).toContain('00000000-0000-0000-0000-0000000000c1');
    
    // Trace by deployment URI
    const resDeploy = await tracer.traceDeployment(p1, 'https://staging.app/deploy/123');
    expect(resDeploy.evidenceIds).toContain('11111111-1111-1111-1111-111111111111');
    expect(resDeploy.verificationIds).toContain('22222222-2222-2222-2222-222222222222');

    // Trace by artifact ID
    const resArtifact = await tracer.traceArtifact(p1, artifactId);
    expect(resArtifact.evidenceIds).toContain('11111111-1111-1111-1111-111111111111');

    // Trace by evidence ID
    const resEvidence = await tracer.traceEvidence(p1, '11111111-1111-1111-1111-111111111111');
    expect(resEvidence.verificationIds).toContain('22222222-2222-2222-2222-222222222222');

    // Trace by verification ID
    const resVer = await tracer.traceVerification(p1, '22222222-2222-2222-2222-222222222222');
    expect(resVer.evidenceIds).toContain('11111111-1111-1111-1111-111111111111');
    expect(resVer.completionDecisionIds).toContain('00000000-0000-0000-0000-0000000000c1');

    // Negative tests: non-existent queries
    const nonExistentCommit = await tracer.traceScmCommit(p1, 'unknown_sha');
    expect(nonExistentCommit.evidenceIds).toHaveLength(0);
    const nonExistentDeploy = await tracer.traceDeployment(p1, 'https://unknown.uri');
    expect(nonExistentDeploy.evidenceIds).toHaveLength(0);

    // Negative tests: project isolation
    const isolatedCommit = await tracer.traceScmCommit(p2, 'commit_sha_123');
    expect(isolatedCommit.evidenceIds).toHaveLength(0);
    const isolatedDeploy = await tracer.traceDeployment(p2, 'https://staging.app/deploy/123');
    expect(isolatedDeploy.evidenceIds).toHaveLength(0);
    const isolatedEvidence = await tracer.traceEvidence(p2, '11111111-1111-1111-1111-111111111111');
    expect(isolatedEvidence.verificationIds).toHaveLength(0);
  });

  it('Run Reconstruction: CAN_RECONSTRUCT_RUN_FROM_PERSISTED_OR_DURABLE_RECORDS=true', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const runId = 'reconstructed-run-42';

    // 1. Create logs
    const logger = new PrismaExecutionLogger(prisma, undefined, () => new Date('2026-09-05T01:00:00Z'));
    await logger.initialize(p1, runId);
    logger.log(p1, runId, 'Run step 1 started', { stream: 'SYSTEM' });
    logger.log(p1, runId, 'Run step 1 completed', { stream: 'STDOUT' });
    await logger.flush();

    // 2. Create incidents
    const incSvc = new PrismaIncidentService(prisma, undefined, () => new Date('2026-09-05T01:00:01Z'));
    await incSvc.initialize(p1);
    incSvc.openIncident(p1, runId, 'Transient network glitch during step 1', 'LOW');
    await incSvc.flush();

    // 3. Reconstruct run purely from persisted DB records
    const fetchedLogs = await logger.getLogsAsync(p1, { runId });
    const fetchedIncidents = await incSvc.listIncidentEventsAsync(p1);

    const timeline = RunReconstructor.reconstructByRun(p1, runId, fetchedLogs, fetchedIncidents);

    expect(timeline.length).toBeGreaterThanOrEqual(3);
    expect(timeline[0].type).toBe('LOG');
    expect(timeline[timeline.length - 1].type).toBe('INCIDENT_EVENT');

    // Explicit invariant check requested by Delegated Orchestrator:
    expect(CAN_RECONSTRUCT_RUN_FROM_PERSISTED_OR_DURABLE_RECORDS).toBe(true);
  });

  it('Execution Logs: deterministic failure-injection proves first-write failure, zero record loss, observable failure, bounded retry/recovery, no duplicates, valid sequence and hash chain, and project isolation', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const p2 = '00000000-0000-0000-0000-000000000002';
    
    let logIdCounter = 0;
    const redactor = {
      redact: (s: string) => s.replace('secret_val', '[REDACTED]')
    };

    const logger = new PrismaExecutionLogger(
      prisma,
      redactor,
      () => new Date('2026-09-05T02:00:00Z'),
      () => `fail-log-${++logIdCounter}`,
      { autoFlush: false }
    );
    await logger.initialize(p1, 'run-fail');

    const originalCreateMany = prisma.executionLogRecord.createMany;
    let failCreateMany = true;
    prisma.executionLogRecord.createMany = async (args) => {
      if (failCreateMany) {
        throw new Error('Injected PostgreSQL connection outage');
      }
      return originalCreateMany.call(prisma.executionLogRecord, args);
    };

    try {
      logger.log(p1, 'run-fail', 'message 1 secret_val', { stream: 'STDOUT' });
      logger.log(p1, 'run-fail', 'message 2', { stream: 'STDERR' });

      // Before flush: 2 items pending in queue, no error yet
      expect(logger.pendingCount).toBe(2);
      expect(logger.getLastError()).toBeNull();

      // First flush must fail and throw:
      await expect(logger.flush()).rejects.toThrow('Injected PostgreSQL connection outage');

      // Failure must be observable:
      expect(logger.getLastError()).not.toBeNull();
      expect(logger.getLastError()?.message).toContain('Injected PostgreSQL connection outage');

      // CRITICAL: Zero record loss! Records MUST NOT be silently discarded from queue
      expect(logger.pendingCount).toBe(2);

      // Verify nothing persisted to database yet
      const dbLogsBefore = await logger.getLogsAsync(p1, { runId: 'run-fail' });
      expect(dbLogsBefore).toHaveLength(0);

      // Verify project isolation during failure
      const dbLogsP2Before = await logger.getLogsAsync(p2);
      expect(dbLogsP2Before).toHaveLength(0);

      // Buffer an additional log while database remains down
      logger.log(p1, 'run-fail', 'message 3 after failure', { stream: 'SYSTEM' });
      expect(logger.pendingCount).toBe(3);

      // Recover database:
      failCreateMany = false;

      // Retry flush
      await logger.flush();

      // All records persisted, queue drained, error cleared
      expect(logger.pendingCount).toBe(0);
      expect(logger.getLastError()).toBeNull();

      // Verify all 3 records persisted once, in exact sequence, with hash chain
      const dbLogsAfter = await logger.getLogsAsync(p1, { runId: 'run-fail' });
      expect(dbLogsAfter).toHaveLength(3);
      expect(dbLogsAfter[0].message).toBe('message 1 [REDACTED]');
      expect(dbLogsAfter[1].message).toBe('message 2');
      expect(dbLogsAfter[2].message).toBe('message 3 after failure');
      expect(dbLogsAfter[0].sequence).toBe(1);
      expect(dbLogsAfter[1].sequence).toBe(2);
      expect(dbLogsAfter[2].sequence).toBe(3);
      expect(dbLogsAfter[1].previousHash).toBe(dbLogsAfter[0].hash);
      expect(dbLogsAfter[2].previousHash).toBe(dbLogsAfter[1].hash);

      // Project isolation preserved
      const dbLogsP2After = await logger.getLogsAsync(p2);
      expect(dbLogsP2After).toHaveLength(0);

      // Retry flush again: verify idempotency, no duplicate persistence
      await logger.flush();
      const dbLogsRecheck = await logger.getLogsAsync(p1, { runId: 'run-fail' });
      expect(dbLogsRecheck).toHaveLength(3);

      // Bounded retry test with configured maxRetries:
      let retryAttempts = 0;
      failCreateMany = true;
      prisma.executionLogRecord.createMany = async (args) => {
        retryAttempts++;
        if (retryAttempts <= 2) {
          throw new Error(`Transient failure ${retryAttempts}`);
        }
        return originalCreateMany.call(prisma.executionLogRecord, args);
      };

      const retryLogger = new PrismaExecutionLogger(
        prisma,
        redactor,
        () => new Date('2026-09-05T02:05:00Z'),
        () => `retry-log-${++logIdCounter}`,
        { autoFlush: false, maxRetries: 2, retryDelayMs: 5 }
      );
      await retryLogger.initialize(p1, 'run-retry');
      retryLogger.log(p1, 'run-retry', 'retry log message');
      expect(retryLogger.pendingCount).toBe(1);

      // Flush should retry boundedly and succeed on attempt 3 without throwing
      await retryLogger.flush();
      expect(retryAttempts).toBe(3);
      expect(retryLogger.pendingCount).toBe(0);
      const retryLogs = await retryLogger.getLogsAsync(p1, { runId: 'run-retry' });
      expect(retryLogs).toHaveLength(1);
      expect(retryLogs[0].message).toBe('retry log message');
    } finally {
      prisma.executionLogRecord.createMany = originalCreateMany;
    }
  });

  it('Incidents: deterministic failure-injection proves first-write failure, zero record loss, observable failure, bounded retry/recovery, no duplicates, valid sequence and hash chain, and project isolation', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const p2 = '00000000-0000-0000-0000-000000000002';
    
    let incIdCounter = 0;
    const redactor = {
      redact: (s: string) => s.replace('secret_api_key', '[REDACTED]')
    };

    const incSvc = new PrismaIncidentService(
      prisma,
      redactor,
      () => new Date('2026-09-05T02:00:00Z'),
      () => `fail-inc-evt-${++incIdCounter}`,
      () => 'fixed-incident-id',
      { autoFlush: false }
    );
    await incSvc.initialize(p1);

    const originalCreateMany = prisma.incidentEventRecord.createMany;
    let failCreateMany = true;

    prisma.incidentEventRecord.createMany = async (args) => {
      if (failCreateMany) {
        throw new Error('Injected incident PostgreSQL outage');
      }
      return originalCreateMany.call(prisma.incidentEventRecord, args);
    };

    try {
      const inc = incSvc.openIncident(p1, 'run-inc-fail', 'network down with secret_api_key', 'HIGH');
      incSvc.mitigateIncident(p1, inc.incidentId, 'applied route mitigation');

      // Before flush: 2 items pending, no error yet
      expect(incSvc.pendingCount).toBe(2);
      expect(incSvc.getLastError()).toBeNull();

      // First flush must fail and throw:
      await expect(incSvc.flush()).rejects.toThrow('Injected incident PostgreSQL outage');

      // Failure must be observable:
      expect(incSvc.getLastError()).not.toBeNull();
      expect(incSvc.getLastError()?.message).toContain('Injected incident PostgreSQL outage');

      // CRITICAL: Zero record loss! Records MUST NOT be silently discarded
      expect(incSvc.pendingCount).toBe(2);

      // Verify nothing in DB yet
      const dbEvtsBefore = (await incSvc.listIncidentEventsAsync(p1)).filter(e => e.runId === 'run-inc-fail');
      expect(dbEvtsBefore).toHaveLength(0);

      // Project isolation during failure
      const dbEvtsP2Before = await incSvc.listIncidentEventsAsync(p2);
      expect(dbEvtsP2Before).toHaveLength(0);

      // Buffer resolution transition while database is down
      incSvc.resolveIncident(p1, inc.incidentId, 'restored connectivity');
      expect(incSvc.pendingCount).toBe(3);

      // Recover database:
      failCreateMany = false;

      // Retry flush
      await incSvc.flush();

      // All records persisted, queue drained, error cleared
      expect(incSvc.pendingCount).toBe(0);
      expect(incSvc.getLastError()).toBeNull();

      // Verify all 3 records persisted once, in exact sequence, with hash chain
      const dbEvtsAfter = (await incSvc.listIncidentEventsAsync(p1)).filter(e => e.runId === 'run-inc-fail');
      expect(dbEvtsAfter).toHaveLength(3);
      expect(dbEvtsAfter[0].state).toBe('OPEN');
      expect(dbEvtsAfter[0].description).toBe('network down with [REDACTED]');
      expect(dbEvtsAfter[1].state).toBe('MITIGATED');
      expect(dbEvtsAfter[2].state).toBe('RESOLVED');
      expect(dbEvtsAfter[0].sequence).toBe(1);
      expect(dbEvtsAfter[1].sequence).toBe(2);
      expect(dbEvtsAfter[2].sequence).toBe(3);
      expect(dbEvtsAfter[1].previousHash).toBe(dbEvtsAfter[0].hash);
      expect(dbEvtsAfter[2].previousHash).toBe(dbEvtsAfter[1].hash);

      // Project isolation preserved
      const dbEvtsP2After = await incSvc.listIncidentEventsAsync(p2);
      expect(dbEvtsP2After).toHaveLength(0);

      // Retry flush again: verify idempotency, no duplicate persistence
      await incSvc.flush();
      const dbEvtsRecheck = (await incSvc.listIncidentEventsAsync(p1)).filter(e => e.runId === 'run-inc-fail');
      expect(dbEvtsRecheck).toHaveLength(3);

      // Bounded retry test with configured maxRetries:
      let retryAttempts = 0;
      failCreateMany = true;
      prisma.incidentEventRecord.createMany = async (args) => {
        retryAttempts++;
        if (retryAttempts <= 2) {
          throw new Error(`Transient incident failure ${retryAttempts}`);
        }
        return originalCreateMany.call(prisma.incidentEventRecord, args);
      };

      const retryIncSvc = new PrismaIncidentService(
        prisma,
        redactor,
        () => new Date('2026-09-05T02:05:00Z'),
        () => `retry-inc-evt-${++incIdCounter}`,
        () => 'retry-incident-id',
        { autoFlush: false, maxRetries: 2, retryDelayMs: 5 }
      );
      await retryIncSvc.initialize(p1);
      retryIncSvc.openIncident(p1, 'run-retry', 'retry incident', 'LOW');
      expect(retryIncSvc.pendingCount).toBe(1);

      // Flush should retry boundedly and succeed on attempt 3 without throwing
      await retryIncSvc.flush();
      expect(retryAttempts).toBe(3);
      expect(retryIncSvc.pendingCount).toBe(0);
      const retryEvents = (await retryIncSvc.listIncidentEventsAsync(p1)).filter(e => e.runId === 'run-retry');
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0].state).toBe('OPEN');
    } finally {
      prisma.incidentEventRecord.createMany = originalCreateMany;
    }
  });

  it('Execution Logs: deterministic concurrency test proves flush serialization, zero queue-loss race, no skipped records, pendingCount=0', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const runId = 'run-race-logger';
    
    let logIdCounter = 0;
    const logger = new PrismaExecutionLogger(
      prisma,
      undefined,
      () => new Date('2026-09-05T03:00:00Z'),
      () => `conc-log-${++logIdCounter}`,
      { autoFlush: false, batchSize: 2 }
    );
    await logger.initialize(p1, runId);

    // Initial batch A: 2 records
    logger.log(p1, runId, 'Batch A - Record 1');
    logger.log(p1, runId, 'Batch A - Record 2');
    expect(logger.pendingCount).toBe(2);

    const originalCreateMany = prisma.executionLogRecord.createMany;
    let dbCallCount = 0;
    let releaseFirstDbCall: () => void;
    const firstDbGate = new Promise<void>(resolve => {
      releaseFirstDbCall = resolve;
    });

    try {
      prisma.executionLogRecord.createMany = async (args) => {
        dbCallCount++;
        if (dbCallCount === 1) {
          // Hold the first DB call until explicitly released
          await firstDbGate;
        }
        return originalCreateMany.call(prisma.executionLogRecord, args);
      };

      // 1. Start one flush (will be held inside createMany)
      const flush1Promise = logger.flush();

      // Give event loop a tick to ensure flush1 enters createMany and holds
      await new Promise(r => setTimeout(r, 20));
      expect(dbCallCount).toBe(1);

      // 2. Append a second batch B while the first DB call is held
      logger.log(p1, runId, 'Batch B - Record 3');
      logger.log(p1, runId, 'Batch B - Record 4');
      // Queue has Batch A in flight + Batch B appended
      expect(logger.pendingCount).toBe(4);

      // 3. Invoke concurrent second flush while first DB call is held
      const flush2Promise = logger.flush();

      // 4. Release the first call
      releaseFirstDbCall!();

      // Wait for both flushes to resolve
      await Promise.all([flush1Promise, flush2Promise]);

      // 5. Assert: pendingCount is 0, no errors
      expect(logger.pendingCount).toBe(0);
      expect(logger.getLastError()).toBeNull();

      // 6. Prove every accepted record persists exactly once, no skipped B records
      const persisted = await prisma.executionLogRecord.findMany({
        where: { projectId: p1, runId },
        orderBy: { sequence: 'asc' }
      });

      expect(persisted).toHaveLength(4);
      expect(persisted[0].message).toBe('Batch A - Record 1');
      expect(persisted[1].message).toBe('Batch A - Record 2');
      expect(persisted[2].message).toBe('Batch B - Record 3');
      expect(persisted[3].message).toBe('Batch B - Record 4');

      // Strict sequence ordering
      expect(persisted[0].sequence).toBe(1);
      expect(persisted[1].sequence).toBe(2);
      expect(persisted[2].sequence).toBe(3);
      expect(persisted[3].sequence).toBe(4);

      // Unbroken cryptographic hash chain
      expect(persisted[1].previousHash).toBe(persisted[0].hash);
      expect(persisted[2].previousHash).toBe(persisted[1].hash);
      expect(persisted[3].previousHash).toBe(persisted[2].hash);
    } finally {
      prisma.executionLogRecord.createMany = originalCreateMany;
    }
  });

  it('Incidents: deterministic concurrency test proves flush serialization, zero queue-loss race, no skipped records, pendingCount=0', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const runId = 'run-race-incidents';

    let incIdCounter = 0;
    const incSvc = new PrismaIncidentService(
      prisma,
      undefined,
      () => new Date('2026-09-05T03:30:00Z'),
      () => `conc-inc-evt-${++incIdCounter}`,
      () => 'conc-incident-id',
      { autoFlush: false, batchSize: 2 }
    );
    await incSvc.initialize(p1);

    // Initial batch A: 2 records
    const incA = incSvc.openIncident(p1, runId, 'Incident Alpha', 'CRITICAL');
    incSvc.mitigateIncident(p1, incA.incidentId, 'Mitigation Alpha');
    expect(incSvc.pendingCount).toBe(2);

    const originalCreateMany = prisma.incidentEventRecord.createMany;
    let dbCallCount = 0;
    let releaseFirstDbCall: () => void;
    const firstDbGate = new Promise<void>(resolve => {
      releaseFirstDbCall = resolve;
    });

    try {
      prisma.incidentEventRecord.createMany = async (args) => {
        dbCallCount++;
        if (dbCallCount === 1) {
          // Hold the first DB call until explicitly released
          await firstDbGate;
        }
        return originalCreateMany.call(prisma.incidentEventRecord, args);
      };

      // 1. Start one flush (will be held inside createMany)
      const flush1Promise = incSvc.flush();

      // Give event loop a tick to ensure flush1 enters createMany and holds
      await new Promise(r => setTimeout(r, 20));
      expect(dbCallCount).toBe(1);

      // 2. Append a second batch B while the first DB call is held
      const incB = incSvc.openIncident(p1, runId, 'Incident Beta', 'HIGH');
      expect(incB.incidentId).toBeDefined();
      incSvc.resolveIncident(p1, incA.incidentId, 'Resolution Alpha');
      // Queue has Batch A in flight + Batch B appended
      expect(incSvc.pendingCount).toBe(4);

      // 3. Invoke concurrent second flush while first DB call is held
      const flush2Promise = incSvc.flush();

      // 4. Release the first call
      releaseFirstDbCall!();

      // Wait for both flushes to resolve
      await Promise.all([flush1Promise, flush2Promise]);

      // 5. Assert: pendingCount is 0, no errors
      expect(incSvc.pendingCount).toBe(0);
      expect(incSvc.getLastError()).toBeNull();

      // 6. Prove every accepted record persists exactly once, no skipped B records
      const persisted = await prisma.incidentEventRecord.findMany({
        where: { projectId: p1 },
        orderBy: { sequence: 'asc' }
      });
      const runEvents = persisted.filter(e => e.runId === runId || e.incidentId === incA.incidentId);

      expect(runEvents).toHaveLength(4);
      expect(runEvents[0].description).toBe('Incident Alpha');
      expect(runEvents[0].state).toBe('OPEN');
      expect(runEvents[1].state).toBe('MITIGATED');
      expect(runEvents[2].description).toBe('Incident Beta');
      expect(runEvents[2].state).toBe('OPEN');
      expect(runEvents[3].state).toBe('RESOLVED');


      // Strict sequence ordering
      expect(runEvents[0].sequence).toBe(1);
      expect(runEvents[1].sequence).toBe(2);
      expect(runEvents[2].sequence).toBe(3);
      expect(runEvents[3].sequence).toBe(4);

      // Unbroken cryptographic hash chain
      expect(runEvents[1].previousHash).toBe(runEvents[0].hash);
      expect(runEvents[2].previousHash).toBe(runEvents[1].hash);
      expect(runEvents[3].previousHash).toBe(runEvents[2].hash);
    } finally {
      prisma.incidentEventRecord.createMany = originalCreateMany;
    }
  });

  it('Execution Logs: deterministic persistent-failure test proves bounded retries stop, queue retained, lastError observable, no busy-loop DB calls, and explicit recovery flush persists records exactly once', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const runId = 'run-persistent-fail-logger';

    let logIdCounter = 0;
    const logger = new PrismaExecutionLogger(
      prisma,
      undefined,
      () => new Date('2026-09-05T04:00:00Z'),
      () => `term-log-${++logIdCounter}`,
      { autoFlush: true, maxRetries: 2, retryDelayMs: 5 }
    );
    await logger.initialize(p1, runId);

    const originalCreateMany = prisma.executionLogRecord.createMany;
    let createManyCalls = 0;
    let shouldFail = true;

    prisma.executionLogRecord.createMany = async (args) => {
      createManyCalls++;
      if (shouldFail) {
        throw new Error('SIMULATED_PERSISTENT_DB_OUTAGE');
      }
      return originalCreateMany.call(prisma.executionLogRecord, args);
    };

    try {
      // 1. Log message 1 - with autoFlush=true, this schedules a flush
      logger.log(p1, runId, 'Terminal Log 1');
      expect(logger.pendingCount).toBe(1);

      // Wait for the background retry budget to be fully exhausted
      // maxRetries = 2 -> 1 initial attempt + 2 retries = 3 calls total
      await new Promise(r => setTimeout(r, 80));

      // 2. Prove retry attempts stop at the configured bound (1 initial + 2 retries = 3 calls)
      expect(createManyCalls).toBe(3);
      expect(logger.pendingCount).toBe(1);
      expect(logger.getLastError()).toBeInstanceOf(Error);
      expect(logger.getLastError()?.message).toBe('SIMULATED_PERSISTENT_DB_OUTAGE');

      // 3. Wait further to prove NO busy-loop / repeated DB calls continue in background
      await new Promise(r => setTimeout(r, 60));
      expect(createManyCalls).toBe(3);

      // 4. Log message 2 while in terminal failure state - verify no busy-loop triggered
      logger.log(p1, runId, 'Terminal Log 2');
      expect(logger.pendingCount).toBe(2);
      await new Promise(r => setTimeout(r, 60));
      // Call count must NOT increase because circuit breaker / error state stops automatic rescheduling
      expect(createManyCalls).toBe(3);
      expect(logger.getLastError()?.message).toBe('SIMULATED_PERSISTENT_DB_OUTAGE');

      // 5. Simulate DB recovery and perform explicit recovery flush
      shouldFail = false;
      await logger.flush();

      // 6. Prove queue is drained, error cleared, and records persisted exactly once
      expect(logger.pendingCount).toBe(0);
      expect(logger.getLastError()).toBeNull();

      const persisted = await prisma.executionLogRecord.findMany({
        where: { projectId: p1, runId },
        orderBy: { sequence: 'asc' }
      });

      expect(persisted).toHaveLength(2);
      expect(persisted[0].message).toBe('Terminal Log 1');
      expect(persisted[0].sequence).toBe(1);
      expect(persisted[1].message).toBe('Terminal Log 2');
      expect(persisted[1].sequence).toBe(2);
      expect(persisted[1].previousHash).toBe(persisted[0].hash);
    } finally {
      prisma.executionLogRecord.createMany = originalCreateMany;
    }
  });

  it('Incidents: deterministic persistent-failure test proves bounded retries stop, queue retained, lastError observable, no busy-loop DB calls, and explicit recovery flush persists records exactly once', async () => {
    const p1 = '00000000-0000-0000-0000-000000000001';
    const runId = 'run-persistent-fail-incidents';

    let incIdCounter = 0;
    const incSvc = new PrismaIncidentService(
      prisma,
      undefined,
      () => new Date('2026-09-05T04:30:00Z'),
      () => `term-inc-evt-${++incIdCounter}`,
      () => 'term-incident-id',
      { autoFlush: true, maxRetries: 2, retryDelayMs: 5 }
    );
    await incSvc.initialize(p1);

    const originalCreateMany = prisma.incidentEventRecord.createMany;
    let createManyCalls = 0;
    let shouldFail = true;

    prisma.incidentEventRecord.createMany = async (args) => {
      createManyCalls++;
      if (shouldFail) {
        throw new Error('SIMULATED_PERSISTENT_INCIDENT_DB_OUTAGE');
      }
      return originalCreateMany.call(prisma.incidentEventRecord, args);
    };

    try {
      // 1. Open incident 1 - with autoFlush=true, this schedules a flush
      const inc1 = incSvc.openIncident(p1, runId, 'Terminal Incident Alpha', 'HIGH');
      expect(incSvc.pendingCount).toBe(1);

      // Wait for the background retry budget to be fully exhausted
      // maxRetries = 2 -> 1 initial attempt + 2 retries = 3 calls total
      await new Promise(r => setTimeout(r, 80));

      // 2. Prove retry attempts stop at the configured bound (1 initial + 2 retries = 3 calls)
      expect(createManyCalls).toBe(3);
      expect(incSvc.pendingCount).toBe(1);
      expect(incSvc.getLastError()).toBeInstanceOf(Error);
      expect(incSvc.getLastError()?.message).toBe('SIMULATED_PERSISTENT_INCIDENT_DB_OUTAGE');

      // 3. Wait further to prove NO busy-loop / repeated DB calls continue in background
      await new Promise(r => setTimeout(r, 60));
      expect(createManyCalls).toBe(3);

      // 4. Record second event while in terminal failure state - verify no busy-loop triggered
      incSvc.mitigateIncident(p1, inc1.incidentId, 'Mitigating Alpha during outage');
      expect(incSvc.pendingCount).toBe(2);
      await new Promise(r => setTimeout(r, 60));
      // Call count must NOT increase because circuit breaker / error state stops automatic rescheduling
      expect(createManyCalls).toBe(3);
      expect(incSvc.getLastError()?.message).toBe('SIMULATED_PERSISTENT_INCIDENT_DB_OUTAGE');

      // 5. Simulate DB recovery and perform explicit recovery flush
      shouldFail = false;
      await incSvc.flush();

      // 6. Prove queue is drained, error cleared, and records persisted exactly once
      expect(incSvc.pendingCount).toBe(0);
      expect(incSvc.getLastError()).toBeNull();

      const persisted = await prisma.incidentEventRecord.findMany({
        where: { projectId: p1, runId },
        orderBy: { sequence: 'asc' }
      });

      expect(persisted).toHaveLength(2);
      expect(persisted[0].description).toBe('Terminal Incident Alpha');
      expect(persisted[0].state).toBe('OPEN');
      expect(persisted[0].sequence).toBe(1);
      expect(persisted[1].resolutionClaim).toBe('Mitigating Alpha during outage');
      expect(persisted[1].state).toBe('MITIGATED');
      expect(persisted[1].sequence).toBe(2);
      expect(persisted[1].previousHash).toBe(persisted[0].hash);
    } finally {
      prisma.incidentEventRecord.createMany = originalCreateMany;
    }
  });
});


