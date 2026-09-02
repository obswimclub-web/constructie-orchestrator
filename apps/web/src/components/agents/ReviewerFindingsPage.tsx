import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useFetch } from '../../data/hooks';
import { fetchFindings } from '../../data/api';
import { ShieldAlert, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';
import { DataState } from '../ui/DataState';

export function ReviewerFindingsPage() {
  const { data: findings, loading, error, isStale, isDegraded } = useFetch(fetchFindings);

  return (
    <div className="max-w-[1600px] mx-auto pb-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Reviewer Findings</h2>
          <p className="text-slate-500">Independent verification and security bounds checking</p>
        </div>
      </div>

      <DataState 
        loading={loading} 
        error={error} 
        empty={!findings || findings.length === 0} 
        emptyMessage="No findings available"
        isStale={isStale}
        isDegraded={isDegraded}
      >
        <div className="flex flex-col gap-4">
          {findings?.map(finding => (
            <Card key={finding.id} className={finding.severity === 'CRITICAL' ? 'border-red-200' : ''}>
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <ShieldAlert className={`w-5 h-5 ${finding.severity === 'CRITICAL' ? 'text-red-500' : finding.severity === 'HIGH' ? 'text-amber-500' : 'text-blue-500'}`} />
                      <h3 className="text-lg font-bold text-slate-900">{finding.criteria}</h3>
                      <Badge variant={finding.severity === 'CRITICAL' ? 'danger' : finding.severity === 'HIGH' ? 'warning' : 'info'}>
                        {finding.severity}
                      </Badge>
                      <Badge variant={finding.verdict === 'PASS' ? 'success' : 'danger'}>
                        {finding.verdict}
                      </Badge>
                      {finding.repaired && <Badge variant="success">REPAIRED</Badge>}
                    </div>
                    
                    <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm border border-slate-100 font-mono text-slate-700">
                      <p className="font-semibold font-sans mb-1 text-slate-900 flex items-center gap-1.5">
                        <FileText className="w-4 h-4" /> Evidence
                      </p>
                      {finding.evidence}
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col gap-2 min-w-[160px]">
                    <button disabled className="w-full bg-slate-50 border border-slate-200 text-slate-400 px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed">
                      View Run
                    </button>
                    {finding.verdict === 'FAIL' && !finding.repaired && (
                      <button disabled className="w-full bg-slate-100 text-slate-400 px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed flex items-center justify-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> Autorepair
                      </button>
                    )}
                    {finding.repaired && (
                      <div className="w-full bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> Verified
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataState>
    </div>
  );
}
