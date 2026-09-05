/* global process, console */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const migrationFiles = [
  'infra/migrations/0001_canonical_project_event.sql',
  'infra/migrations/0002_work_item_attempt.sql',
  'infra/migrations/0003_evidence_verification.sql',
  'packages/persistence/prisma/migrations/0004_completion_decisions/migration.sql',
  'packages/persistence/prisma/migrations/0005_attempt_agent_run_binding/migration.sql',
  'packages/persistence/prisma/migrations/0006_real_approval_model/migration.sql',
  'packages/persistence/prisma/migrations/0007_p9_evidence_lineage/migration.sql',
];

for (const relative of migrationFiles) {
  const file = resolve(relative);
  if (!existsSync(file)) {
    console.error(`Missing migration: ${relative}`);
    process.exit(3);
  }
  console.log(`Applying ${relative}`);
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`Failed to execute psql for ${relative}:`, result.error.message);
    process.exit(4);
  }
  if (result.status !== 0) process.exit(result.status ?? 5);
}

console.log('All canonical SQL migrations applied successfully.');
