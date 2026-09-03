import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { WorkStore } from '@co/persistence';
import { MinimalWorkflowEngine } from '@co/workflow';
import { MockAgentAdapter } from '@co/agents';
import { WorkerHost } from './worker.js';

export const appName = '@co/worker' as const;

export async function bootstrap() {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orchestrator';

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  const workStore = new WorkStore(prisma);
  const engine = new MinimalWorkflowEngine(workStore);

  // The MockAgentAdapter is the canonical agent bridge for this phase.
  // It simulates realistic agent execution (COMPLETED / FAILED / INTERRUPTED)
  // without requiring live LLM credentials, keeping the worker runtime genuinely
  // operational while real adapters are wired in subsequent phases.
  const adapter_ = new MockAgentAdapter('SUCCESS');

  const host = new WorkerHost(prisma, workStore, engine, adapter_);

  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM received — initiating graceful shutdown');
    await host.stop();
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[worker] SIGINT received — initiating graceful shutdown');
    await host.stop();
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });

  console.log('[worker] Starting WorkerHost');
  await host.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch(err => {
    console.error('[worker] Fatal error during bootstrap:', err);
    process.exit(1);
  });
}
