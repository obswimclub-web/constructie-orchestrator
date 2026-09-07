/* global process, console */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  console.error('DATABASE_URL is invalid.');
  process.exit(2);
}

const childEnv = { ...process.env };
childEnv.PGHOST = parsedUrl.hostname;
childEnv.PGPORT = parsedUrl.port || '5432';
if (parsedUrl.username) childEnv.PGUSER = decodeURIComponent(parsedUrl.username);
if (parsedUrl.password) childEnv.PGPASSWORD = decodeURIComponent(parsedUrl.password);
childEnv.PGDATABASE = parsedUrl.pathname.replace(/^\//, '');

const sslmode = parsedUrl.searchParams.get('sslmode');
if (sslmode) {
  childEnv.PGSSLMODE = sslmode;
}

const migrationFiles = [
  'infra/migrations/0001_canonical_project_event.sql',
  'infra/migrations/0002_work_item_attempt.sql',
  'infra/migrations/0003_evidence_verification.sql',
  'packages/persistence/prisma/migrations/0004_completion_decisions/migration.sql',
  'packages/persistence/prisma/migrations/0005_attempt_agent_run_binding/migration.sql',
  'packages/persistence/prisma/migrations/0006_real_approval_model/migration.sql',
  'packages/persistence/prisma/migrations/0007_p9_evidence_lineage/migration.sql',
  'packages/persistence/prisma/migrations/0008_p9_s3_observability/migration.sql',
  'packages/persistence/prisma/migrations/0009_r60_evidence_reqs/migration.sql',
];

for (const relative of migrationFiles) {
  const file = resolve(relative);
  if (!existsSync(file)) {
    console.error(`Missing migration: ${relative}`);
    process.exit(3);
  }
  console.log(`Applying ${relative}`);
  const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', file], {
    stdio: 'inherit',
    env: childEnv,
  });
  if (result.error) {
    console.error(`Failed to execute psql for ${relative}:`, result.error.message);
    process.exit(4);
  }
  if (result.status !== 0) process.exit(result.status ?? 5);
}

console.log('All canonical SQL migrations applied successfully.');
