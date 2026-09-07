import crypto from 'node:crypto';

export function generateStableEvidenceId(runId: string, claimSupported: string): string {
  const hash = crypto.createHash('sha256').update(runId + ':' + claimSupported).digest('hex');
  return hash.slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
