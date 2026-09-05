# Disaster Recovery and Backup Procedures

## Overview
This document defines the formal backup and recovery procedures for the Constructie Orchestrator production environment on Railway.

## 1. Backup Posture (Railway PostgreSQL)
Railway provides volume backup schedules as a platform capability (Daily, Weekly, Monthly) with retention bounds based on the chosen tier/schedule. Point-In-Time Recovery (PITR) is also available as a platform capability when specifically enabled.

- **PLATFORM_CAPABILITY**: Automated scheduled volume backups and PITR (if configured).
- **CURRENT_PRODUCTION_CONFIGURATION**: 
  - Automated snapshot backups: **Enabled**
  - CURRENT_PRODUCTION_PITR_ENABLED: **UNKNOWN_NOT_VERIFIED** (Not natively enabled by default on the current instance).

## 2. Recovery Procedure
If a database corruption or data loss event occurs, the following steps must be taken to restore service:

### Step 2.1: Assess and Isolate
1. **Stop Worker and API**: Prevent further corruption or partial semantic execution by temporarily disabling the `@co/worker` and `@co/api` services in the Railway dashboard.
2. **Preserve Current State**: If possible, trigger a manual snapshot of the corrupted state for forensic analysis before restoring.

### Step 2.2: Restore from Snapshot
1. Navigate to the Railway Dashboard -> `helpful-courtesy` project.
2. Select the `Postgres-h43c` service.
3. Open the **Backups** configuration and select the most recent known-good snapshot.
4. Execute the platform snapshot restore.

*(Note: During P10-R1, a logical backup (`pg_dump`) was verified against an isolated non-production container. This proved logical DB integrity, schema, and migration recoverability, but did NOT execute a native Railway volume restore or a PITR restore against production.)*

### Step 2.3: Verify Integrity
1. Connect to the restored database via Railway CLI tunnel.
2. Run integrity queries to verify `_prisma_migrations`, `work_items`, and `execution_log_records`.

### Step 2.4: Resume Operations
1. Restart the `@co/api`, `@co/web`, and `@co/worker` services.
2. The `RunCoordinator` and `MinimalWorkflowEngine` use transactional state management and UUID constraints (`WorkItemNotReadyError`) to safely dispatch pending items. However, explicit deterministic tests (`tests/integration/restart-resume-postgres.spec.ts`) must be consulted to verify the precise bounds of resuming incomplete attempts without duplicate semantic side-effects.
3. Monitor the API and Worker logs for 15 minutes to confirm stable continuous operation.

## 3. Incident Documentation
After recovery, open a formal incident record in `incident_event_records` tracking the data loss, the restore timestamp, and any identified root cause or semantic gaps.
