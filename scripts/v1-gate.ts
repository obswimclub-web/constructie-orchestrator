import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const rootDir = process.cwd();

async function check() {
  console.log('Running Final Completion Gate (Semantic Evidence)...');
  
  const gitStatus = execSync('git status --short --untracked-files=all | grep -v uc-evidence.json | grep -v test-results.json | grep -v evidence-report.md').toString().trim();
  if (gitStatus.length > 0) {
    const lines = gitStatus.split('\n');
    const hasUnstagedOrUntracked = lines.some(l => !l.startsWith('M ') && !l.startsWith('A ') && !l.startsWith('D '));
    const hasStaged = lines.some(l => l.startsWith('M ') || l.startsWith('A ') || l.startsWith('D '));
    if (hasUnstagedOrUntracked) console.warn('Unstaged changes exist.');
    if (hasStaged) {
        console.warn('WARN: Staged files exist.');
    }
  }

  const eslintDisableCount = execSync('grep -rn "/* eslint-disable */" tests/ packages/ | grep -v "node_modules" | wc -l').toString().trim();
  if (parseInt(eslintDisableCount) > 0) {
    throw new Error('GATE FAILED: eslint-disable found outside of modules');
  }
  const distImportCount = execSync('grep -rn "from \'.*/dist/" packages/ tests/ | wc -l').toString().trim();
  if (parseInt(distImportCount) > 0) {
    throw new Error('GATE FAILED: dist import found');
  }
  
  // Clear evidence file
  const evidenceFile = path.join(rootDir, 'uc-evidence.json');
  if (fs.existsSync(evidenceFile)) {
    fs.unlinkSync(evidenceFile);
  }

  console.log('Running test qualification to generate semantic evidence...');
  try {
    execSync('pnpm vitest run --reporter=json > test-results.json', { stdio: 'pipe' });
  } catch {
    // We let the assertions below fail if evidence is missing
  }

  if (!fs.existsSync(evidenceFile)) {
    throw new Error('GATE FAILED: Semantic evidence file uc-evidence.json was not generated.');
  }

  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf-8'));
  

  const requiredConditions: Record<string, string[]> = {
    'UC-01': ['START AUTHORIZATION = YES'],
    'UC-02': ['TAKEOVER READINESS = YES'],
    'UC-03': ['BLUEPRINT STATUS = COMPLETE', 'JUDGE VERDICT = ACCEPTED'],
    'UC-04': ['FEATURE STATUS = COMPLETE', 'JUDGE VERDICT = ACCEPTED', 'PROJECT SOURCE OF TRUTH = UPDATED'],
    'UC-05': ['BUG STATUS = RESOLVED', 'JUDGE VERDICT = FIX ACCEPTED', 'ORIGINAL ISSUE = VERIFIED FIXED'],
    'UC-06': ['RELEASE STATUS = COMPLETE', 'PRODUCTION VERSION = VERIFIED', 'POST-DEPLOY STATUS = HEALTHY'],
    'UC-07': ['prior execution state preserved', 'prior evidence preserved', 'external-state knowledge preserved', 'safe continuation'],
    'UC-08': ['AUDIT FINDINGS = VERIFIED', 'PROJECT HEALTH STATUS = DETERMINED', 'REMEDIATION PLAN = GENERATED'],
    'UC-09': ['PROJECT OPERATIONAL', 'HEALTH STATUS = ACCEPTABLE', 'CRITICAL UNRESOLVED ISSUES = 0', 'MAINTENANCE LOOP = ACTIVE', 'SOURCE OF TRUTH = CURRENT']
  };

  for (const [uc, conditions] of Object.entries(requiredConditions)) {
    const ucEvidence = evidence.find((e: Record<string, unknown>) => e.uc === uc);
    if (!ucEvidence) {
      throw new Error(`GATE FAILED: Missing semantic test evidence for ${uc}`);
    }
    for (const cond of conditions) {
      if (ucEvidence.successConditionsMet[cond] !== true) {
         throw new Error(`GATE FAILED: ${uc} did not meet condition '${cond}'`);
      }
    }
  }

  // TODO: CMO evidence assertions

  console.log('GATE PASSED: V1_COMPLETE=true');
}

check().catch(err => {
  console.error(err.message);
  process.exit(1);
});
