import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub Actions Governance', () => {
  it('QUAL-001 Lockfile Workflow does not have git write operations', () => {
    const wfPath = path.resolve(__dirname, '../../.github/workflows/qual-001-lockfile.yml');
    const content = fs.readFileSync(wfPath, 'utf8');

    // Permissions check
    expect(content).toContain('permissions:');
    expect(content).toContain('  contents: read');
    expect(content).not.toMatch(/contents:\s*write/);

    // No git commit/add/push check
    expect(content).not.toContain('git config');
    expect(content).not.toContain('git add');
    expect(content).not.toContain('git commit');
    expect(content).not.toContain('git push');
    
    // No branch/ref mutation
    expect(content).not.toContain('refs/heads/');
  });
});
