export interface ReviewerFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  criteria: string;
  evidence: string;
  verdict: 'PASS' | 'FAIL' | 'MANUAL_REVIEW_REQUIRED';
  repaired: boolean;
}
