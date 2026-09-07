import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('apply-sql-migrations.mjs secret containment', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExit: NodeJS.Process['exit'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalLog: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalExit = process.exit;
    originalLog = console.log;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.exit = vi.fn() as any;
    console.log = vi.fn();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalLog;
    vi.clearAllMocks();
  });

  it('safely passes connection details via ENV without exposing secrets in ARGV', async () => {
    process.env.DATABASE_URL = 'postgresql://testuser:testp%40ssword@localhost:5432/testdb?sslmode=require';
    process.env.PGOPTIONS = '-c lock_timeout=5000';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs.existsSync as any).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child_process.spawnSync as any).mockReturnValue({ status: 0 });

    // Execute the script dynamically
    await import('../../scripts/apply-sql-migrations.mjs');

    expect(child_process.spawnSync).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (child_process.spawnSync as any).mock.calls;

    // Pick first call (first migration)
    const [command, args, options] = calls[0];

    expect(command).toBe('psql');

    // DATABASE_URL_NOT_IN_ARGV=PASS
    expect(args.some((a: string) => a.includes('postgresql://'))).toBe(false);
    expect(args.some((a: string) => a.includes('testdb'))).toBe(false);

    // PASSWORD_NOT_IN_ARGV=PASS
    expect(args.some((a: string) => a.includes('testp@ssword'))).toBe(false);
    expect(args.some((a: string) => a.includes('testp%40ssword'))).toBe(false);

    // PSQL_RECEIVES_CONNECTION_VIA_ENV=PASS
    expect(options.env.PGUSER).toBe('testuser');
    expect(options.env.PGPASSWORD).toBe('testp@ssword');
    expect(options.env.PGHOST).toBe('localhost');
    expect(options.env.PGPORT).toBe('5432');
    expect(options.env.PGDATABASE).toBe('testdb');
    expect(options.env.PGSSLMODE).toBe('require');

    // PGOPTIONS_PRESERVED=PASS
    expect(options.env.PGOPTIONS).toBe('-c lock_timeout=5000');

    // MIGRATION_FILE_ARGUMENTS_UNCHANGED=PASS
    expect(args).toEqual(['-v', 'ON_ERROR_STOP=1', '-f', expect.stringContaining('0001_canonical_project_event.sql')]);
  });
});
